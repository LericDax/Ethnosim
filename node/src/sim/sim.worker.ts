import { createSeededRng, type SeededRng, type RngStream } from './engine/rng.ts';
import {
  createBrainState,
  tickBrain,
  type BrainState,
  type BrainDecision,
  type BrainMultiplierSet,
  getCurrentNodeMetadata,
  getNodeMetadata,
  serializeBrainState,
  cloneBrainDecision,
  type SerializedBrainState,
  type BrainPulseAppearance,
} from './engine/brain.ts';
import {
  createInitialMovementState,
  moveAgent,
  type MovableAgent,
  type MovementContext,
} from './engine/move.ts';
import {
  createWorld,
  clampPosition,
  harvestForestResource,
  isForestTile,
  type WorldState,
} from './engine/world.ts';
import { handleReproduction, matchReproductivePartners } from './engine/repro.ts';
import { createTraitProfile } from './engine/traits.ts';
import {
  assignAgentsToHouses,
  createHouseState,
  createInitialHouses,
  createUrbanCenter,
  updateCollectiveDemands,
  HOUSE_CONSTRUCTION_COST,
  HOUSE_CONSTRUCTION_COOLDOWN,
  HOUSE_CONSTRUCTION_RETRY_DELAY,
  cloneLeaderDescriptor,
  createHouseCapacityController,
  ensureHouseCapacity,
  setHouseCapacityDefaults,
  setHouseCapacityForArchetype,
  type HouseAssignableAgent,
  type HouseState,
  type CityState,
  type ResourceBundle,
  type ResourceType,
  type CollectiveLeaderDescriptor,
  type HouseCapacityController,
  type HouseCapacityPatch,
} from './engine/collectives.ts';
import {
  stepAging,
  STAGE_BASE_SPEED,
  STAGE_BRAIN_IDS,
  STAGE_LIMITS,
} from './engine/aging.ts';
import {
  buildChromosomeRegistry,
  sampleChromosomes,
  cloneAgentChromosomes,
  cloneChromosomeRegistry,
  type AgentChromosomes,
  type ChromosomeRegistry,
} from './engine/chromosomes.ts';
import { resolveScenario, scenarioToSimulationDefaults } from './data/scenarios.ts';
import type { ReproductiveGroup } from './engine/repro.ts';

export type LifeStage = 'baby' | 'child' | 'teen' | 'adult';

export interface Temperament {
  trustBias: number;
  fearBias: number;
  loyaltyBias: number;
  resentmentBias: number;
  territorialBias: number;
  zealBias: number;
}

export interface PregnancyState {
  timeRemaining: number;
  fetusTemperament: Temperament;
  coParentId: string | null;
}

export interface StageCounts {
  baby: number;
  child: number;
  teen: number;
  adult: number;
}

export interface AgentResourceActivity {
  harvested?: ResourceBundle;
  delivered?: ResourceBundle;
}

export interface LeadershipSummary {
  houses: Record<string, CollectiveLeaderDescriptor[]>;
  city: CollectiveLeaderDescriptor[];
  updatedAtTick: number;
}

export interface AgentState extends MovableAgent, HouseAssignableAgent {
  ageTicks: number;
  chromosomes: AgentChromosomes;
  reproductiveRoles: AgentChromosomes['roles'];
  genderIdentity: 'man' | 'woman' | 'nonbinary';
  fertility: number;
  pregnancy: PregnancyState | null;
  bondPartnerId: string | null;
  reproductiveGroupId: string | null;
  reproductiveGroupRole: string | null;
  parents: string[];
  temperament: Temperament;
  traitFlags: string[];
  moods: Record<string, number>;
  brainNodeDuration: number;
  carriedResources: ResourceBundle;
  resourceActivity: AgentResourceActivity | null;
}

interface SimulationRng {
  root: SeededRng;
  world: RngStream;
  agentSpawn: RngStream;
  tick: RngStream;
  collectives: RngStream;
}

export interface SimulationState {
  tick: number;
  world: WorldState;
  agents: AgentState[];
  houses: HouseState[];
  city: CityState | null;
  rng: SimulationRng;
  stageCounts: StageCounts;
  nextAgentId: number;
  nextHouseId: number;
  reproductiveGroups: ReproductiveGroup[];
  nextReproductiveGroupId: number;
  scenarioId: string;
  seed: string;
  chromosomeRegistry: ChromosomeRegistry;
  leadership: LeadershipSummary;
  housing: HouseCapacityController;
  pendingHouseAssignments: string[];
}

export interface SimulationConfig {
  worldSize?: [number, number];
  agentCount?: number;
  seed?: number | string | bigint | null;
  scenarioId?: string | null;
}

type SnapshotResourceBundle = Record<ResourceType, number>;

const RESOURCE_CARRY_CAPACITY = 6;
const RESOURCE_GATHER_RATE = 1.5;
const RESOURCE_DELIVERY_RADIUS_BUFFER = 2.5;
const UNHOUSED_MOOD_KEY = 'unhoused';
const UNHOUSED_MOOD_INCREASE_RATE = 0.12;
const UNHOUSED_MOOD_DECAY_RATE = 0.08;
const UNHOUSED_MOOD_MAX = 3;
// Nodes in agent brains that actively harvest resources when present on resource tiles.
const RESOURCE_GATHER_NODES = new Set<string>(['Gather', 'BuildDwelling']);

const MAX_SNAPSHOT_PULSES = 32;
const MAX_SNAPSHOT_FILL_NODES = 32;

interface SnapshotBrainTransitionTiming {
  durationTicks: number;
  remainingTicks: number;
  elapsedTicks: number;
  startedAtTick: number;
  updatedAtTick: number;
  tickIntervalMs: number;
  ticksPerUpdate: number;
  tickDurationMs: number;
}

interface SnapshotBrainSummary {
  brainId: string;
  nodeId: string;
  nodeTimer: number;
  nodeDuration: number;
  decision: BrainDecision | null;
  traitFlags: string[];
  baseFrequency: number;
  tags: string[];
  transition: SnapshotBrainTransitionTiming | null;
}

interface SnapshotBrainPulse {
  id: string;
  edgeId: string;
  progress: number;
  strength: number;
  payload?: number;
  payloadRate?: number;
  rate?: number;
  durationTicks?: number;
  travelDurationTicks?: number;
  elapsedTicks?: number;
  remainingTicks?: number;
  appearance?: BrainPulseAppearance;
  color?: string;
  glow?: number;
  glowStrength?: number;
  glowColor?: string;
  glowSize?: number;
  glowOpacity?: number;
  size?: number;
  sizeBoost?: number;
  opacity?: number;
  opacityBoost?: number;
  brightness?: number;
  trailColor?: string;
  trailWidth?: number;
  family?: string;
}

interface SnapshotBrainFill {
  ratios: Record<string, number>;
  containsRecentCharge: boolean;
  lockedNodeId: string | null;
}

interface SnapshotBrainData {
  summary: SnapshotBrainSummary;
  state: SerializedBrainState;
  pulses: SnapshotBrainPulse[];
  fillRatios: Record<string, number>;
  nodeFill?: SnapshotBrainFill | null;
}

interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
  lifeStage: LifeStage;
  ageStage: LifeStage;
  brainNode: string;
  brain: SnapshotBrainData;
  houseId: string | null;
  pregnant: boolean;
  fertility: number;
  moods: Record<string, number>;
  brainMultipliers: BrainMultiplierSet;
  traitFlags: string[];
  temperament: Temperament;
  ageTicks: number;
  speed: number;
  chromosomes: AgentState['chromosomes'];
  reproductiveRoles: AgentState['reproductiveRoles'];
  genderIdentity: AgentState['genderIdentity'];
  bondPartnerId: string | null;
  reproductiveGroupId: string | null;
  reproductiveGroupRole: string | null;
  parents: string[];
  carriedResources: SnapshotResourceBundle;
  resourceActivity: SnapshotAgentResourceActivity | null;
}

interface SnapshotReproductiveGroupMember {
  agentId: string;
  role: string;
}

interface SnapshotReproductiveGroup {
  id: string;
  formedAtTick: number;
  members: SnapshotReproductiveGroupMember[];
}

interface SnapshotAgentResourceActivity {
  harvested?: SnapshotResourceBundle;
  delivered?: SnapshotResourceBundle;
}

interface SnapshotLeader {
  agentId: string;
  role: string;
  title: string;
  method: string;
  score: number;
  support: number;
  selectedAtTick: number;
  temperament: Temperament;
  traitFlags: string[];
  notes?: string;
}

interface SnapshotHouseConstruction {
  active: boolean;
  progress: number;
  required: number;
  cooldownUntil: number;
}

interface SnapshotHouse {
  id: string;
  x: number;
  y: number;
  radius: number;
  members: string[];
  authority: number;
  brain: SnapshotBrainData;
  demand: Record<string, number>;
  stockpiles: SnapshotResourceBundle;
  construction: SnapshotHouseConstruction;
  primaryLeaderId: string | null;
  leaders: SnapshotLeader[];
  leaderDirectives: Record<string, number>;
  maxMembers: number;
  preferredMembers: number | null;
  capacityPressure: number;
  archetypeId: string | null;
}

interface SnapshotCity {
  id: string;
  x: number;
  y: number;
  radius: number;
  authority: number;
  brain: SnapshotBrainData;
  demand: Record<string, number>;
  demandExpiresAt: number;
  stockpiles: SnapshotResourceBundle;
  primaryLeaderId: string | null;
  leaders: SnapshotLeader[];
  leaderDirectives: Record<string, number>;
}

interface SnapshotDecision {
  agent_id: string;
  from: string;
  to: string;
}

type DemandScope = 'agent' | 'house' | 'city' | 'terrain';

interface SnapshotDemand {
  sourceId: string;
  scope: DemandScope;
  origin: [number, number];
  radius: number;
  targets: string[];
  multiplier: number;
  expiresAtTick: number;
}

export interface Snapshot {
  type: 'SNAPSHOT';
  version: number;
  scenarioId: string;
  seed: number;
  seedHex: string;
  tick: number;
  world: { width: number; height: number; w: number; h: number };
  agents: SnapshotAgent[];
  houses: SnapshotHouse[];
  city: SnapshotCity | null;
  demands: SnapshotDemand[];
  decisions: SnapshotDecision[];
  stats: StageCounts;
  chromosomes: ChromosomeRegistry;
  reproductiveGroups: SnapshotReproductiveGroup[];
  leadership: SnapshotLeadershipState;
}

interface SnapshotLeadershipState {
  houses: Record<string, SnapshotLeader[]>;
  city: SnapshotLeader[];
  updatedAtTick: number;
}

interface WorkerInitMessage {
  type: 'INIT';
  worldSize?: [number, number];
  agentCount?: number;
  seed?: number | string | bigint | null;
  scenarioId?: string | null;
  intervalMs?: number;
  ticksPerUpdate?: number;
}

interface WorkerStopMessage {
  type: 'STOP';
}

interface WorkerPauseMessage {
  type: 'PAUSE';
}

interface WorkerResumeMessage {
  type: 'RESUME';
}

interface WorkerSetTickIntervalMessage {
  type: 'SET_TICK_INTERVAL';
  intervalMs: number;
}

interface WorkerSetTicksPerUpdateMessage {
  type: 'SET_TICKS_PER_UPDATE';
  ticksPerUpdate: number;
}

interface WorkerRequestSnapshotMessage {
  type: 'REQUEST_SNAPSHOT';
}

interface WorkerTrackAgentMessage {
  type: 'TRACK_AGENT';
  id: string | null;
}

interface WorkerAdjustHousingCapacityMessage {
  type: 'ADJUST_HOUSING_CAPACITY';
  target: 'default' | 'archetype';
  archetypeId?: string | null;
  patch?: HouseCapacityPatch | null;
  applyToExisting?: boolean;
}

type WorkerMessage =
  | WorkerInitMessage
  | WorkerStopMessage
  | WorkerPauseMessage
  | WorkerResumeMessage
  | WorkerSetTickIntervalMessage
  | WorkerSetTicksPerUpdateMessage
  | WorkerRequestSnapshotMessage
  | WorkerTrackAgentMessage
  | WorkerAdjustHousingCapacityMessage;

interface WorkerContext {
  postMessage: (data: unknown) => void;
  addEventListener: (type: string, listener: (event: { data: unknown }) => void) => void;
}

const LIFE_STAGES: LifeStage[] = ['baby', 'child', 'teen', 'adult'];

const workerContext: WorkerContext | null =
  typeof self !== 'undefined' && typeof (self as any).postMessage === 'function'
    ? (self as WorkerContext)
    : null;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let state: SimulationState | null = null;
let isPaused = false;
let tickIntervalMs = 500;
let ticksPerUpdate = 1;
let trackedAgentId: string | null = null;
let trackedAgentDecision: BrainDecision | null = null;

interface TrackedTransition {
  from: string;
  to: string;
}

let trackedAgentTransition: TrackedTransition | null = null;

if (workerContext) {
  workerContext.addEventListener('message', (event) => {
    const message = event.data as WorkerMessage | null;
    if (!message || typeof (message as { type?: unknown }).type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'INIT':
        initializeSimulation(message);
        break;
      case 'STOP':
        stopSimulation();
        break;
      case 'PAUSE':
        pauseSimulation();
        break;
      case 'RESUME':
        resumeSimulation();
        break;
      case 'SET_TICK_INTERVAL':
        updateTickInterval(message.intervalMs);
        break;
      case 'SET_TICKS_PER_UPDATE':
        updateTicksPerUpdate(message.ticksPerUpdate);
        break;
      case 'REQUEST_SNAPSHOT':
        postSnapshot();
        break;
      case 'TRACK_AGENT':
        trackAgent(message.id);
        break;
      case 'ADJUST_HOUSING_CAPACITY':
        adjustHousingCapacity(message);
        break;
      default:
        break;
    }
  });
}

function initializeSimulation(message: WorkerInitMessage): void {
  stopSimulation();

  const config: SimulationConfig = {
    seed: message.seed,
    scenarioId: message.scenarioId ?? null,
  };
  if (message.worldSize) {
    config.worldSize = message.worldSize;
  }
  if (typeof message.agentCount === 'number') {
    config.agentCount = message.agentCount;
  }

  state = createSimulationState(config);

  postSnapshot();

  tickIntervalMs = sanitizeTickInterval(message.intervalMs);
  ticksPerUpdate = sanitizeTicksPerUpdate(message.ticksPerUpdate);
  isPaused = false;
  scheduleTickLoop();
}

function stopSimulation(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state = null;
  isPaused = false;
  trackedAgentId = null;
  trackedAgentDecision = null;
  trackedAgentTransition = null;
}

function postSnapshot(): void {
  if (!workerContext || !state) {
    return;
  }
  workerContext.postMessage(createSnapshot(state));
}

function trackAgent(id: string | null): void {
  if (typeof id === 'string' && id.trim().length > 0) {
    trackedAgentId = id;
  } else {
    trackedAgentId = null;
  }
  trackedAgentDecision = null;
  trackedAgentTransition = null;

  if (trackedAgentId && state) {
    const agent = state.agents.find((entry) => entry.id === trackedAgentId) ?? null;
    if (!agent) {
      trackedAgentId = null;
      return;
    }

    if (agent.brainDecision) {
      trackedAgentDecision = cloneBrainDecision(agent.brainDecision);
      trackedAgentTransition = {
        from: agent.brainDecision.fromNodeId,
        to: agent.brainDecision.chosenNodeId,
      };
    }
  }
}

function scheduleTickLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  if (isPaused || !state) {
    return;
  }

  intervalHandle = setInterval(runSimulationStep, tickIntervalMs);
}

function runSimulationStep(): void {
  if (!state || isPaused) {
    return;
  }

  for (let i = 0; i < ticksPerUpdate; i += 1) {
    stepSimulationState(state);
  }
  postSnapshot();
}

function pauseSimulation(): void {
  if (isPaused) {
    return;
  }
  isPaused = true;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function resumeSimulation(): void {
  if (!state) {
    return;
  }
  if (!isPaused) {
    return;
  }
  isPaused = false;
  scheduleTickLoop();
}

function updateTickInterval(interval: number): void {
  tickIntervalMs = sanitizeTickInterval(interval);
  scheduleTickLoop();
}

function updateTicksPerUpdate(value: number): void {
  ticksPerUpdate = sanitizeTicksPerUpdate(value);
}

function sanitizeTickInterval(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return tickIntervalMs;
  }
  const clamped = Math.max(16, Math.min(10000, Math.floor(value)));
  return clamped;
}

function sanitizeTicksPerUpdate(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return ticksPerUpdate;
  }
  const clamped = Math.max(1, Math.min(200, Math.floor(value)));
  return clamped;
}

export function createSimulationState(config: SimulationConfig): SimulationState {
  const { id: scenarioId, config: scenarioConfig } = resolveScenario(config.scenarioId ?? null);
  const defaults = scenarioToSimulationDefaults(scenarioConfig);
  const worldSize = config.worldSize ?? defaults.worldSize;
  const [rawWidth, rawHeight] = worldSize;
  const width = Math.max(1, Math.floor(rawWidth));
  const height = Math.max(1, Math.floor(rawHeight));
  const desiredAgentCount = config.agentCount ?? defaults.agentCount;
  const agentCount = Math.max(1, Math.floor(desiredAgentCount));

  const rootRng = createSeededRng(config.seed);
  const seedString = rootRng.serialize().seed;
  const worldStream = rootRng.stream('world');
  const agentStream = rootRng.stream('agent-spawn');
  const tickStream = rootRng.stream('tick');
  const collectivesStream = rootRng.stream('collectives');

  const world = createWorld(width, height, worldStream);
  const chromosomeRegistry = buildChromosomeRegistry(
    scenarioConfig.population?.chromosomes ?? null,
  );
  const agents = createAgents(agentCount, width, height, agentStream, chromosomeRegistry);
  const housing = createHouseCapacityController(scenarioConfig.housing ?? null);
  const houses = createInitialHouses({
    width,
    height,
    rng: collectivesStream,
    agents,
    housing,
    defaultArchetypeId: housing.defaultArchetypeId,
  });
  const city = createUrbanCenter({
    width,
    height,
    rng: collectivesStream,
  });
  const stageCounts = computeStageCounts(agents);

  const simulation: SimulationState = {
    tick: 0,
    world,
    agents,
    houses,
    city,
    rng: {
      root: rootRng,
      world: worldStream,
      agentSpawn: agentStream,
      tick: tickStream,
      collectives: collectivesStream,
    },
    stageCounts,
    nextAgentId: agents.length,
    nextHouseId: houses.length,
    reproductiveGroups: [],
    nextReproductiveGroupId: 0,
    scenarioId,
    seed: seedString,
    chromosomeRegistry,
    leadership: {
      houses: buildLeadershipHouseMap(houses),
      city: city ? city.leaders.map((leader) => cloneLeaderDescriptor(leader)) : [],
      updatedAtTick: 0,
    },
    housing,
    pendingHouseAssignments: [],
  };

  const initialAssignment = assignAgentsToHouses(simulation.houses, simulation.agents, {
    currentTick: simulation.tick,
    rng: simulation.rng.collectives,
  });
  const initialAgentMap = buildAgentMap(simulation.agents);
  updateHousingQueue(simulation, initialAssignment.overflowAgents, initialAgentMap);
  updateHousingMoods(simulation);
  if (initialAssignment.allHousesFull && initialAssignment.overflowAgents.length > 0) {
    for (const house of simulation.houses) {
      if (!house.construction.active) {
        house.construction.active = true;
      }
    }
  }
  updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick, {
    rng: simulation.rng.collectives,
    pendingAssignmentCount: simulation.pendingHouseAssignments.length,
  });
  updateLeadershipLedger(simulation);

  matchReproductivePartners(simulation);

  return simulation;
}

function createAgents(
  count: number,
  width: number,
  height: number,
  stream: RngStream,
  chromosomeRegistry: ChromosomeRegistry,
): AgentState[] {
  const agents: AgentState[] = [];
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const homeRadius = Math.min(width, height) * 0.1;
  for (let i = 0; i < count; i += 1) {
    const lifeStage = LIFE_STAGES[i % LIFE_STAGES.length];
    const brainId = STAGE_BRAIN_IDS[lifeStage] ?? 'AdultMind_v1';
    const brain = createBrainState(brainId);
    const temperament = createRandomTemperament(stream, lifeStage);
    const traitProfile = createTraitProfile(temperament);
    brain.traitFlags = [...traitProfile.traitFlags];
    const brainMetadata = getCurrentNodeMetadata(brain);
    const chromosomes = sampleChromosomes(chromosomeRegistry, stream);
    const reproductiveRoles = [...chromosomes.roles];
    const genderIdentity = sampleGenderIdentity(stream.nextFloat());
    const fertility =
      lifeStage === 'adult' && reproductiveRoles.includes('gestator')
        ? 0.4 + stream.nextFloat() * 0.5
        : 0;
    const baseSpeed = STAGE_BASE_SPEED[lifeStage] ?? 0;
    const speedVariance = lifeStage === 'baby' ? 0 : (stream.nextFloat() - 0.5) * 0.2;
    const ageLimit = STAGE_LIMITS[lifeStage];
    const ageTicks =
      typeof ageLimit === 'number' && ageLimit > 0
        ? Math.floor(stream.nextFloat() * Math.max(1, Math.floor(ageLimit * 0.75)))
        : 0;

    agents.push({
      id: `agent-${i}`,
      x: stream.nextFloat() * width,
      y: stream.nextFloat() * height,
      lifeStage,
      ageTicks,
      speed: Math.max(0, baseSpeed + speedVariance),
      homeX: centerX + (stream.nextFloat() - 0.5) * homeRadius,
      homeY: centerY + (stream.nextFloat() - 0.5) * homeRadius,
      caregiverId: null,
      explorationBias: stream.nextFloat(),
      brain,
      brainMultipliers: buildBrainMultipliers(traitProfile),
      brainNodeDuration: brainMetadata.duration,
      brainDecision: null,
      chromosomes,
      reproductiveRoles,
      genderIdentity,
      fertility,
      pregnancy: null,
      bondPartnerId: null,
      reproductiveGroupId: null,
      reproductiveGroupRole: null,
      parents: [],
      temperament,
      traitFlags: [...traitProfile.traitFlags],
      moods: buildInitialMoodState(traitProfile),
      houseId: null,
      carriedResources: { wood: 0 },
      resourceActivity: null,
      movement: createInitialMovementState(),
    });
  }

  const adults = agents.filter((agent) => agent.lifeStage === 'adult');
  agents.forEach((agent) => {
    if (agent.lifeStage === 'baby' || agent.lifeStage === 'child') {
      if (adults.length > 0) {
        const caregiver = adults[Math.floor(stream.nextFloat() * adults.length)];
        agent.caregiverId = caregiver.id;
      }
      if (agent.lifeStage === 'baby') {
        agent.speed = STAGE_BASE_SPEED.baby;
      }
    }
  });

  return agents;
}

function createRandomTemperament(stream: RngStream, lifeStage: LifeStage): Temperament {
  const range = lifeStage === 'adult' ? 0.5 : 0.6;
  return {
    trustBias: clamp01(0.2 + stream.nextFloat() * range),
    fearBias: clamp01(0.2 + stream.nextFloat() * range),
    loyaltyBias: clamp01(0.2 + stream.nextFloat() * range),
    resentmentBias: clamp01(0.2 + stream.nextFloat() * range),
    territorialBias: clamp01(0.2 + stream.nextFloat() * range),
    zealBias: clamp01(0.2 + stream.nextFloat() * range),
  };
}

function sampleGenderIdentity(sample: number): AgentState['genderIdentity'] {
  if (sample < 0.4) {
    return 'man';
  }
  if (sample < 0.8) {
    return 'woman';
  }
  return 'nonbinary';
}

function shuffleInPlace<T>(array: T[], stream: RngStream): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(stream.nextFloat() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}

function buildBrainMultipliers(profile: ReturnType<typeof createTraitProfile>): BrainMultiplierSet {
  const multipliers: BrainMultiplierSet = { demand: {} };
  if (profile.multipliers.mood) {
    multipliers.mood = { ...profile.multipliers.mood };
  }
  if (profile.multipliers.personality) {
    multipliers.personality = { ...profile.multipliers.personality };
  }
  return multipliers;
}

function buildInitialMoodState(profile: ReturnType<typeof createTraitProfile>): Record<string, number> {
  const moods: Record<string, number> = { ...profile.moodLevels };
  moods[UNHOUSED_MOOD_KEY] = 0;
  return moods;
}

function cloneLeadershipArray(leaders: CollectiveLeaderDescriptor[]): CollectiveLeaderDescriptor[] {
  if (!Array.isArray(leaders) || leaders.length === 0) {
    return [];
  }
  return leaders.map((leader) => cloneLeaderDescriptor(leader));
}

function buildLeadershipHouseMap(houses: HouseState[]): Record<string, CollectiveLeaderDescriptor[]> {
  const map: Record<string, CollectiveLeaderDescriptor[]> = {};
  for (const house of houses) {
    map[house.id] = cloneLeadershipArray(house.leaders);
  }
  return map;
}

function updateLeadershipLedger(simulation: SimulationState): void {
  simulation.leadership = {
    houses: buildLeadershipHouseMap(simulation.houses),
    city: simulation.city ? cloneLeadershipArray(simulation.city.leaders) : [],
    updatedAtTick: simulation.tick,
  };
}

function computeStageCounts(agents: AgentState[]): StageCounts {
  const counts: StageCounts = { baby: 0, child: 0, teen: 0, adult: 0 };
  for (const agent of agents) {
    if (agent.lifeStage === 'baby') {
      counts.baby += 1;
    } else if (agent.lifeStage === 'child') {
      counts.child += 1;
    } else if (agent.lifeStage === 'teen') {
      counts.teen += 1;
    } else if (agent.lifeStage === 'adult') {
      counts.adult += 1;
    }
  }
  return counts;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function stepSimulationState(simulation: SimulationState): void {
  simulation.tick += 1;

  matchReproductivePartners(simulation);
  handleReproduction(simulation);

  const assignment = assignAgentsToHouses(simulation.houses, simulation.agents, {
    currentTick: simulation.tick,
    rng: simulation.rng.collectives,
  });
  const agentsById = buildAgentMap(simulation.agents);
  updateHousingQueue(simulation, assignment.overflowAgents, agentsById);
  updateHousingMoods(simulation);
  for (const house of simulation.houses) {
    if (house.capacityPressure > 0 && !house.construction.active) {
      house.construction.active = true;
    }
  }
  if (assignment.allHousesFull && assignment.overflowAgents.length > 0) {
    for (const house of simulation.houses) {
      if (!house.construction.active) {
        house.construction.active = true;
      }
    }
  }
  updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick, {
    rng: simulation.rng.collectives,
    pendingAssignmentCount: simulation.pendingHouseAssignments.length,
  });
  updateLeadershipLedger(simulation);

  let trackedAgentFound = false;

  simulation.agents.forEach((agent) => {
    const wasTrackedAgent = trackedAgentId === agent.id;
    const previousNodeId = agent.brain.currentNodeId;
    const brainResult = tickBrain(agent.brain, agent.brainMultipliers, agent.moods, {
      rng: simulation.rng.tick,
      tick: simulation.tick,
    });
    agent.brainNodeDuration = brainResult.nodeDuration;
    agent.brainDecision = brainResult.decision;

    if (wasTrackedAgent) {
      trackedAgentFound = true;
      const currentNodeId = agent.brain.currentNodeId;
      if (brainResult.decision && previousNodeId !== currentNodeId) {
        trackedAgentDecision = cloneBrainDecision(brainResult.decision);
        trackedAgentTransition = {
          from: previousNodeId,
          to: currentNodeId,
        };
      } else if (!trackedAgentDecision && brainResult.decision) {
        trackedAgentDecision = cloneBrainDecision(brainResult.decision);
        trackedAgentTransition = {
          from: brainResult.decision.fromNodeId,
          to: brainResult.decision.chosenNodeId,
        };
      }
    }
  });

  if (trackedAgentId && !trackedAgentFound) {
    trackedAgentDecision = null;
    trackedAgentTransition = null;
  }

  const housesById = new Map<string, HouseState>();
  simulation.houses.forEach((house) => {
    housesById.set(house.id, house);
  });

  const movementContext: MovementContext = {
    world: simulation.world,
    agentsById,
    housesById,
    city: simulation.city,
    tick: simulation.tick,
  };

  simulation.agents.forEach((agent) => {
    moveAgent(agent, movementContext, simulation.rng.tick);
  });

  processResourceEconomy(simulation);

  stepAging(simulation, {
    onEnterAdulthood: () => matchReproductivePartners(simulation),
  });

  simulation.stageCounts = computeStageCounts(simulation.agents);
}

function updateHousingMoods(simulation: SimulationState): void {
  if (simulation.agents.length === 0) {
    return;
  }

  const pending = simulation.pendingHouseAssignments.length
    ? new Set(simulation.pendingHouseAssignments)
    : null;

  for (const agent of simulation.agents) {
    if (!agent.moods) {
      agent.moods = { [UNHOUSED_MOOD_KEY]: 0 };
    } else if (!Number.isFinite(agent.moods[UNHOUSED_MOOD_KEY])) {
      agent.moods[UNHOUSED_MOOD_KEY] = 0;
    }

    const current = Number.isFinite(agent.moods[UNHOUSED_MOOD_KEY])
      ? agent.moods[UNHOUSED_MOOD_KEY]
      : 0;
    const awaitingHousing = !agent.houseId || (pending ? pending.has(agent.id) : false);

    let next = current;
    if (awaitingHousing) {
      next = Math.min(UNHOUSED_MOOD_MAX, current + UNHOUSED_MOOD_INCREASE_RATE);
    } else if (current > 0) {
      next = Math.max(0, current - UNHOUSED_MOOD_DECAY_RATE);
    }

    agent.moods[UNHOUSED_MOOD_KEY] = next;
  }
}

function processResourceEconomy(simulation: SimulationState): void {
  if (simulation.agents.length === 0) {
    return;
  }

  const houseMap = new Map<string, HouseState>();
  for (const house of simulation.houses) {
    if (!house.stockpiles) {
      house.stockpiles = { wood: 0 };
    }
    if (!house.construction) {
      house.construction = {
        active: false,
        progress: 0,
        required: HOUSE_CONSTRUCTION_COST,
        cooldownUntil: 0,
      };
    }
    houseMap.set(house.id, house);
  }

  const agentMap = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    if (!agent.carriedResources) {
      agent.carriedResources = { wood: 0 };
    }
    agent.resourceActivity = null;
    agentMap.set(agent.id, agent);
  }

  const newHouses: HouseState[] = [];
  const city = simulation.city;
  if (city && !city.stockpiles) {
    city.stockpiles = { wood: 0 };
  }

  for (const agent of simulation.agents) {
    handleAgentResourceActions(simulation, agent, houseMap, city);
  }

  for (const house of simulation.houses) {
    maybeCompleteHouseConstruction(simulation, house, newHouses, agentMap);
  }

  if (newHouses.length > 0) {
    for (const entry of newHouses) {
      simulation.houses.push(entry);
      houseMap.set(entry.id, entry);
    }
  }
}

function handleAgentResourceActions(
  simulation: SimulationState,
  agent: AgentState,
  houseMap: Map<string, HouseState>,
  city: CityState | null,
): void {
  const nodeId = agent.brain.currentNodeId;
  const canGather = RESOURCE_GATHER_NODES.has(nodeId);

  if (canGather && isForestTile(simulation.world, agent.x, agent.y)) {
    const carriedWood = sanitizeResourceValue(agent.carriedResources.wood);
    const capacity = Math.max(0, RESOURCE_CARRY_CAPACITY - carriedWood);
    if (capacity > 0) {
      const harvested = harvestForestResource(
        simulation.world,
        agent.x,
        agent.y,
        Math.min(capacity, RESOURCE_GATHER_RATE),
      );
      if (harvested > 0) {
        agent.carriedResources.wood = carriedWood + harvested;
        recordAgentResourceActivity(agent, 'harvested', 'wood', harvested);
      }
    }
  }

  const carried = sanitizeResourceValue(agent.carriedResources.wood);
  if (!canGather || carried <= 0) {
    return;
  }

  let delivered = 0;
  const house = agent.houseId ? houseMap.get(agent.houseId) ?? null : null;
  if (house && canDeliverToHouse(agent, house)) {
    delivered = carried;
    applyHouseDelivery(house, delivered);
  } else if (city && canDeliverToCity(agent, city)) {
    delivered = carried;
    applyCityDelivery(city, delivered);
  }

  if (delivered > 0) {
    agent.carriedResources.wood = Math.max(0, carried - delivered);
    recordAgentResourceActivity(agent, 'delivered', 'wood', delivered);
  }
}

function canDeliverToHouse(agent: AgentState, house: HouseState): boolean {
  const dx = agent.x - house.x;
  const dy = agent.y - house.y;
  const reach = Math.max(2, house.radius + RESOURCE_DELIVERY_RADIUS_BUFFER);
  return dx * dx + dy * dy <= reach * reach;
}

function canDeliverToCity(agent: AgentState, city: CityState): boolean {
  const dx = agent.x - city.x;
  const dy = agent.y - city.y;
  const reach = Math.max(3, city.radius + RESOURCE_DELIVERY_RADIUS_BUFFER);
  return dx * dx + dy * dy <= reach * reach;
}

function applyHouseDelivery(house: HouseState, amount: number): void {
  if (amount <= 0) {
    return;
  }
  if (!house.stockpiles) {
    house.stockpiles = { wood: 0 };
  }
  const current = sanitizeResourceValue(house.stockpiles.wood);
  house.stockpiles.wood = current + amount;
  if (!house.construction.active) {
    house.construction.active = true;
  }
  if (house.construction.active) {
    house.construction.progress = Math.min(
      house.construction.required,
      house.construction.progress + amount,
    );
  }
}

function applyCityDelivery(city: CityState, amount: number): void {
  if (amount <= 0) {
    return;
  }
  if (!city.stockpiles) {
    city.stockpiles = { wood: 0 };
  }
  const current = sanitizeResourceValue(city.stockpiles.wood);
  city.stockpiles.wood = current + amount;
}

function recordAgentResourceActivity(
  agent: AgentState,
  type: 'harvested' | 'delivered',
  resource: ResourceType,
  amount: number,
): void {
  if (amount <= 0) {
    return;
  }
  if (!agent.resourceActivity) {
    agent.resourceActivity = {};
  }
  if (type === 'harvested') {
    const bucket = agent.resourceActivity.harvested ?? (agent.resourceActivity.harvested = {});
    bucket[resource] = sanitizeResourceValue(bucket[resource]) + amount;
  } else {
    const bucket = agent.resourceActivity.delivered ?? (agent.resourceActivity.delivered = {});
    bucket[resource] = sanitizeResourceValue(bucket[resource]) + amount;
  }
}

function buildAgentMap(agents: AgentState[]): Map<string, AgentState> {
  const map = new Map<string, AgentState>();
  for (const agent of agents) {
    map.set(agent.id, agent);
  }
  return map;
}

function updateHousingQueue(
  simulation: SimulationState,
  overflowAgents: HouseAssignableAgent[],
  agentMap: Map<string, AgentState>,
): void {
  const seen = new Set<string>();
  const nextQueue: string[] = [];

  for (const id of simulation.pendingHouseAssignments) {
    if (seen.has(id)) {
      continue;
    }
    const agent = agentMap.get(id);
    if (!agent || agent.houseId) {
      continue;
    }
    seen.add(id);
    nextQueue.push(id);
  }

  for (const overflow of overflowAgents) {
    const agent = agentMap.get(overflow.id);
    if (!agent || agent.houseId || seen.has(overflow.id)) {
      continue;
    }
    agent.houseId = null;
    seen.add(overflow.id);
    nextQueue.push(overflow.id);
  }

  simulation.pendingHouseAssignments = nextQueue;
}

function settleAgentIntoHouse(
  simulation: SimulationState,
  agent: AgentState,
  house: HouseState,
): void {
  agent.houseId = house.id;
  const jitterAngle = simulation.rng.collectives.nextFloat() * Math.PI * 2;
  const jitterRadius = house.radius * (0.2 + simulation.rng.collectives.nextFloat() * 0.4);
  const targetX = house.x + Math.cos(jitterAngle) * jitterRadius;
  const targetY = house.y + Math.sin(jitterAngle) * jitterRadius;
  const clamped = clampPosition(simulation.world, targetX, targetY);
  agent.homeX = clamped.x;
  agent.homeY = clamped.y;
  agent.x = clamped.x;
  agent.y = clamped.y;
}

function normalizeArchetypeId(id: string | null | undefined, fallback: string): string {
  if (!id) {
    return fallback;
  }
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function reconcileHousingAfterCapacityChange(simulation: SimulationState): void {
  const assignment = assignAgentsToHouses(simulation.houses, simulation.agents, {
    currentTick: simulation.tick,
    rng: simulation.rng.collectives,
  });
  const agentMap = buildAgentMap(simulation.agents);
  updateHousingQueue(simulation, assignment.overflowAgents, agentMap);
  for (const house of simulation.houses) {
    if (house.capacityPressure > 0 && !house.construction.active) {
      house.construction.active = true;
    }
  }
  updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick, {
    rng: simulation.rng.collectives,
    pendingAssignmentCount: simulation.pendingHouseAssignments.length,
  });
  updateLeadershipLedger(simulation);
}

function adjustHousingCapacity(message: WorkerAdjustHousingCapacityMessage): void {
  if (!state) {
    return;
  }
  if (message.target === 'default') {
    setHouseCapacityDefaults(state.housing, message.patch ?? null);
    if (message.applyToExisting !== false) {
      for (const house of state.houses) {
        ensureHouseCapacity(state.housing, house);
      }
      reconcileHousingAfterCapacityChange(state);
    }
    return;
  }

  const targetId = normalizeArchetypeId(message.archetypeId, state.housing.defaultArchetypeId);
  if (message.patch) {
    setHouseCapacityForArchetype(state.housing, targetId, message.patch);
  } else {
    state.housing.archetypes.delete(targetId);
  }

  if (message.applyToExisting !== false) {
    for (const house of state.houses) {
      const archetypeId = normalizeArchetypeId(house.archetypeId, state.housing.defaultArchetypeId);
      if (archetypeId === targetId) {
        ensureHouseCapacity(state.housing, house);
      }
    }
    reconcileHousingAfterCapacityChange(state);
  }
}

function maybeCompleteHouseConstruction(
  simulation: SimulationState,
  house: HouseState,
  additions: HouseState[],
  agentMap: Map<string, AgentState>,
): void {
  if (!house.construction) {
    return;
  }

  const stockpileWood = sanitizeResourceValue(house.stockpiles.wood);
  if (!house.construction.active) {
    if (stockpileWood > 0) {
      house.construction.active = true;
      house.construction.progress = Math.min(
        house.construction.required,
        Math.max(house.construction.progress, Math.min(stockpileWood, house.construction.required)),
      );
    }
    return;
  }

  if (house.construction.progress < house.construction.required || stockpileWood < HOUSE_CONSTRUCTION_COST) {
    house.construction.progress = Math.min(house.construction.progress, stockpileWood);
    return;
  }

  if (simulation.tick < house.construction.cooldownUntil) {
    return;
  }

  const newHouse = spawnSatelliteHouse(simulation, house, additions);
  if (!newHouse) {
    house.construction.cooldownUntil = simulation.tick + HOUSE_CONSTRUCTION_RETRY_DELAY;
    return;
  }

  const cost = HOUSE_CONSTRUCTION_COST;
  house.stockpiles.wood = Math.max(0, stockpileWood - cost);
  house.construction.progress = 0;
  house.construction.active = false;
  house.construction.cooldownUntil = simulation.tick + HOUSE_CONSTRUCTION_COOLDOWN;

  redistributeMembersToNewHouse(simulation, house, newHouse, agentMap);
  transferStarterResources(house, newHouse);
  additions.push(newHouse);

  if (house.stockpiles.wood >= cost) {
    house.construction.active = true;
    house.construction.progress = Math.min(house.stockpiles.wood, house.construction.required);
  }
}

function spawnSatelliteHouse(
  simulation: SimulationState,
  parent: HouseState,
  additions: HouseState[],
): HouseState | null {
  const stream = simulation.rng.collectives;
  const houses = [...simulation.houses, ...additions];
  const attempts = 10;
  const baseRadius = Math.max(2.4, parent.radius * 0.75);

  for (let i = 0; i < attempts; i += 1) {
    const angle = stream.nextFloat() * Math.PI * 2;
    const distance = parent.radius * (1.4 + stream.nextFloat() * 0.9) + 2.5;
    const rawX = parent.x + Math.cos(angle) * distance;
    const rawY = parent.y + Math.sin(angle) * distance;
    const clamped = clampPosition(simulation.world, rawX, rawY);
    const radius = Math.max(2.2, baseRadius * (0.8 + stream.nextFloat() * 0.5));

    let collision = false;
    for (const other of houses) {
      const dx = other.x - clamped.x;
      const dy = other.y - clamped.y;
      const buffer = other.id === parent.id ? parent.radius * 0.5 : Math.max(2, other.radius * 0.4 + radius * 0.3);
      const minDistance = other.radius + radius + buffer;
      if (dx * dx + dy * dy < minDistance * minDistance) {
        collision = true;
        break;
      }
    }

    if (collision) {
      continue;
    }

    const id = `house-${simulation.nextHouseId}`;
    const newHouse = createHouseState(id, clamped.x, clamped.y, radius, {
      housing: simulation.housing,
      archetypeId: parent.archetypeId ?? simulation.housing.defaultArchetypeId,
    });
    simulation.nextHouseId += 1;
    return newHouse;
  }

  return null;
}

function redistributeMembersToNewHouse(
  simulation: SimulationState,
  parent: HouseState,
  child: HouseState,
  agentMap: Map<string, AgentState>,
): void {
  const parentMembers = parent.members.slice();
  const preferredParent = parent.preferredMembers ?? Math.max(1, Math.floor(parent.maxMembers * 0.8));
  const targetParentCount = Math.max(1, Math.min(parentMembers.length, preferredParent));
  const maxMovable = Math.max(0, parentMembers.length - targetParentCount);
  const childCapacity = Math.max(0, child.maxMembers - child.members.length);
  let moveCount = Math.min(maxMovable, childCapacity);
  if (moveCount <= 0 && childCapacity > 0) {
    moveCount = Math.min(childCapacity, Math.max(0, parentMembers.length - 1));
  }

  const moved: string[] = [];
  if (moveCount > 0) {
    for (const memberId of parentMembers) {
      if (moved.length >= moveCount) {
        break;
      }
      const agent = agentMap.get(memberId);
      if (!agent) {
        continue;
      }
      moved.push(memberId);
      settleAgentIntoHouse(simulation, agent, child);
    }
    if (moved.length > 0) {
      const movedSet = new Set(moved);
      parent.members = parent.members.filter((id) => !movedSet.has(id));
    }
  }

  child.members = moved;

  if (child.members.length < child.maxMembers && simulation.pendingHouseAssignments.length > 0) {
    const nextQueue: string[] = [];
    for (const id of simulation.pendingHouseAssignments) {
      if (child.members.length >= child.maxMembers) {
        nextQueue.push(id);
        continue;
      }
      const agent = agentMap.get(id);
      if (!agent || agent.houseId) {
        continue;
      }
      child.members.push(id);
      settleAgentIntoHouse(simulation, agent, child);
    }
    simulation.pendingHouseAssignments = nextQueue;
  } else if (simulation.pendingHouseAssignments.length > 0) {
    simulation.pendingHouseAssignments = simulation.pendingHouseAssignments.filter((id) => {
      const agent = agentMap.get(id);
      return agent ? !agent.houseId : false;
    });
  }

  if (child.members.length === 0) {
    const availableFromParent = parent.members.filter((id) => agentMap.has(id));
    if (availableFromParent.length > 1) {
      const fallbackId = availableFromParent[0];
      const agent = agentMap.get(fallbackId);
      if (agent) {
        parent.members = parent.members.filter((id) => id !== fallbackId);
        child.members.push(fallbackId);
        settleAgentIntoHouse(simulation, agent, child);
      }
    }
  }

  ensureHouseCapacity(simulation.housing, parent);
  ensureHouseCapacity(simulation.housing, child);
}

function transferStarterResources(parent: HouseState, child: HouseState): void {
  const available = sanitizeResourceValue(parent.stockpiles.wood);
  if (available <= 0) {
    child.stockpiles.wood = sanitizeResourceValue(child.stockpiles.wood);
    return;
  }
  const starter = Math.min(2, available);
  parent.stockpiles.wood = available - starter;
  child.stockpiles.wood = sanitizeResourceValue(child.stockpiles.wood) + starter;
}

function sanitizeResourceValue(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value < 0 ? 0 : value;
}

function roundTo(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
}

function extractSnapshotBrainPulses(brain: BrainState): SnapshotBrainPulse[] {
  if (!brain.pendingPulses.length) {
    return [];
  }
  const pulses = brain.pendingPulses
    .map((pulse) => {
      const edgeId = pulse.edgeKey;
      if (!edgeId) {
        return null;
      }
      const durationTicks = Math.max(1, Math.round(pulse.travelDuration ?? 1));
      const elapsedTicks = Math.max(0, Math.min(durationTicks, Math.round(pulse.elapsed ?? 0)));
      const remainingTicks = Math.max(0, durationTicks - elapsedTicks);
      const payload = Number.isFinite(pulse.payload) ? pulse.payload : pulse.strength;
      const payloadRate = Number.isFinite(pulse.payloadRate)
        ? pulse.payloadRate
        : durationTicks > 0
          ? payload / durationTicks
          : payload;
      const progress = clamp01(
        durationTicks > 0 ? elapsedTicks / durationTicks : elapsedTicks > 0 ? 1 : 0,
      );
      const strength = clamp01(pulse.strength);
      const descriptor: SnapshotBrainPulse = {
        id: pulse.id,
        edgeId,
        progress: roundTo(progress),
        strength: roundTo(strength),
        payload: roundTo(payload),
        payloadRate: roundTo(payloadRate),
        rate: roundTo(payloadRate),
        durationTicks,
        travelDurationTicks: durationTicks,
        elapsedTicks,
        remainingTicks,
      };
      if (pulse.appearance) {
        const appearance: BrainPulseAppearance = { ...pulse.appearance };
        descriptor.appearance = appearance;
        if (appearance.color) {
          descriptor.color = appearance.color;
        }
        if (appearance.glow !== undefined) {
          descriptor.glow = appearance.glow;
        }
        if (appearance.glowStrength !== undefined) {
          descriptor.glowStrength = appearance.glowStrength;
        }
        if (appearance.glowColor) {
          descriptor.glowColor = appearance.glowColor;
        }
        if (appearance.glowSize !== undefined) {
          descriptor.glowSize = appearance.glowSize;
        }
        if (appearance.glowOpacity !== undefined) {
          descriptor.glowOpacity = appearance.glowOpacity;
        }
        if (appearance.size !== undefined) {
          descriptor.size = appearance.size;
        }
        if (appearance.sizeBoost !== undefined) {
          descriptor.sizeBoost = appearance.sizeBoost;
        }
        if (appearance.opacity !== undefined) {
          descriptor.opacity = appearance.opacity;
        }
        if (appearance.opacityBoost !== undefined) {
          descriptor.opacityBoost = appearance.opacityBoost;
        }
        if (appearance.brightness !== undefined) {
          descriptor.brightness = roundTo(appearance.brightness);
        }
        if (appearance.trailColor) {
          descriptor.trailColor = appearance.trailColor;
        }
        if (appearance.trailWidth !== undefined) {
          descriptor.trailWidth = appearance.trailWidth;
        }
        if (appearance.family) {
          descriptor.family = appearance.family;
        }
      }
      return descriptor;
    })
    .filter((pulse): pulse is SnapshotBrainPulse => Boolean(pulse));

  if (pulses.length <= MAX_SNAPSHOT_PULSES) {
    return pulses;
  }
  return pulses
    .sort(
      (a, b) =>
        b.progress - a.progress ||
        (Number(b.payload ?? 0) - Number(a.payload ?? 0)) ||
        b.strength - a.strength,
    )
    .slice(0, MAX_SNAPSHOT_PULSES);
}

function extractSnapshotFillRatios(brain: BrainState): SnapshotBrainFill | null {
  const combined = new Map<
    string,
    {
      ratio: number;
      fromCache: boolean;
    }
  >();
  let containsRecentCharge = false;
  let strongestCachedNode: string | null = null;
  let strongestCachedRatio = -Infinity;

  for (const [nodeId, charge] of brain.nodeCharge.entries()) {
    const metadata = getNodeMetadata(brain.brainId, nodeId);
    const capacity = charge?.capacity ?? metadata.chargeCapacity;
    const safeCapacity = capacity > 0 ? capacity : 1;
    const ratio = clamp01((charge?.value ?? 0) / safeCapacity);
    if (ratio <= 0 || !nodeId) {
      continue;
    }
    combined.set(nodeId, { ratio, fromCache: false });
  }

  for (const [nodeId, charge] of brain.recentCharge.entries()) {
    const metadata = getNodeMetadata(brain.brainId, nodeId);
    const capacity = charge?.capacity ?? metadata.chargeCapacity;
    const safeCapacity = capacity > 0 ? capacity : 1;
    const ratio = clamp01((charge?.value ?? 0) / safeCapacity);
    if (ratio <= 0 || !nodeId) {
      continue;
    }
    containsRecentCharge = true;
    if (ratio > strongestCachedRatio) {
      strongestCachedRatio = ratio;
      strongestCachedNode = nodeId;
    }
    const existing = combined.get(nodeId);
    if (!existing || existing.fromCache) {
      combined.set(nodeId, { ratio, fromCache: true });
    }
  }

  if (combined.size === 0) {
    return null;
  }

  let lockedNodeId = brain.lastDecision?.chosenNodeId ?? null;
  if (lockedNodeId && !combined.has(lockedNodeId)) {
    lockedNodeId = null;
  }
  if (!lockedNodeId && strongestCachedNode && combined.has(strongestCachedNode)) {
    lockedNodeId = strongestCachedNode;
  }

  if (lockedNodeId) {
    const entry = combined.get(lockedNodeId);
    if (entry) {
      entry.ratio = 1;
      combined.set(lockedNodeId, entry);
    }
  }

  const entries = Array.from(combined.entries())
    .map(([nodeId, info]) => ({ nodeId, ratio: clamp01(info.ratio) }))
    .filter((entry) => entry.nodeId && entry.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio || a.nodeId.localeCompare(b.nodeId));

  const limited = entries.slice(0, MAX_SNAPSHOT_FILL_NODES);
  if (lockedNodeId) {
    const hasLocked = limited.some((entry) => entry.nodeId === lockedNodeId);
    if (!hasLocked) {
      const lockedEntry = entries.find((entry) => entry.nodeId === lockedNodeId);
      if (lockedEntry) {
        if (limited.length >= MAX_SNAPSHOT_FILL_NODES) {
          limited[limited.length - 1] = lockedEntry;
        } else {
          limited.push(lockedEntry);
        }
        limited.sort((a, b) => b.ratio - a.ratio || a.nodeId.localeCompare(b.nodeId));
      }
    }
  }
  if (!limited.length) {
    return null;
  }

  const ratios: Record<string, number> = {};
  for (const entry of limited) {
    ratios[entry.nodeId] = roundTo(entry.ratio);
  }

  return {
    ratios,
    containsRecentCharge,
    lockedNodeId,
  } satisfies SnapshotBrainFill;
}

const SAFE_NUMBER_MASK = BigInt('0x1fffffffffffff');

export function createSnapshot(simulation: SimulationState): Snapshot {
  const seedBigInt = safeBigInt(simulation.seed);
  const limitedSeed = Number(seedBigInt & SAFE_NUMBER_MASK);
  const seedHex = `0x${seedBigInt.toString(16)}`;

  return {
    type: 'SNAPSHOT',
    version: 2,
    scenarioId: simulation.scenarioId,
    seed: Number.isFinite(limitedSeed) ? limitedSeed : 0,
    seedHex,
    tick: simulation.tick,
    world: {
      width: simulation.world.width,
      height: simulation.world.height,
      w: simulation.world.width,
      h: simulation.world.height,
    },
    agents: simulation.agents.map((agent) => createSnapshotAgent(agent, simulation.tick)),
    houses: simulation.houses.map((house) => createSnapshotHouse(house, simulation.tick)),
    city: simulation.city ? createSnapshotCity(simulation.city, simulation.tick) : null,
    demands: [],
    decisions: createSnapshotDecisions(simulation),
    stats: { ...simulation.stageCounts },
    chromosomes: cloneChromosomeRegistry(simulation.chromosomeRegistry),
    reproductiveGroups: simulation.reproductiveGroups.map((group) =>
      createSnapshotReproductiveGroup(group),
    ),
    leadership: createSnapshotLeadership(simulation),
  };
}

function createSnapshotAgent(agent: AgentState, currentTick: number): SnapshotAgent {
  return {
    id: agent.id,
    x: agent.x,
    y: agent.y,
    lifeStage: agent.lifeStage,
    ageStage: agent.lifeStage,
    brainNode: agent.brain.currentNodeId,
    brain: createBrainSnapshot(agent.brain, agent.brainNodeDuration, agent.brainDecision, currentTick),
    houseId: agent.houseId ?? null,
    pregnant: Boolean(agent.pregnancy),
    fertility: agent.fertility,
    moods: { ...agent.moods },
    brainMultipliers: cloneBrainMultipliers(agent.brainMultipliers),
    traitFlags: [...agent.traitFlags],
    temperament: { ...agent.temperament },
    ageTicks: agent.ageTicks,
    speed: agent.speed,
    chromosomes: cloneAgentChromosomes(agent.chromosomes),
    reproductiveRoles: [...agent.reproductiveRoles],
    genderIdentity: agent.genderIdentity,
    bondPartnerId: agent.bondPartnerId,
    reproductiveGroupId: agent.reproductiveGroupId,
    reproductiveGroupRole: agent.reproductiveGroupRole,
    parents: [...agent.parents],
    carriedResources: cloneResourceBundle(agent.carriedResources),
    resourceActivity: cloneAgentResourceActivity(agent.resourceActivity),
  };
}

function createSnapshotReproductiveGroup(group: ReproductiveGroup): SnapshotReproductiveGroup {
  return {
    id: group.id,
    formedAtTick: group.formedAtTick,
    members: group.members.map((member) => ({ agentId: member.agentId, role: member.role })),
  };
}

function createSnapshotHouse(house: HouseState, currentTick: number): SnapshotHouse {
  return {
    id: house.id,
    x: house.x,
    y: house.y,
    radius: house.radius,
    members: [...house.members],
    authority: 0,
    brain: createBrainSnapshot(house.brain, house.brainNodeDuration, house.brainDecision, currentTick),
    demand: { ...house.activeDemand },
    stockpiles: cloneResourceBundle(house.stockpiles),
    construction: cloneHouseConstruction(house.construction),
    primaryLeaderId: house.primaryLeaderId,
    leaders: house.leaders.map((leader) => createSnapshotLeader(leader)),
    leaderDirectives: { ...house.leaderDirectives },
    maxMembers: house.maxMembers,
    preferredMembers: house.preferredMembers,
    capacityPressure: house.capacityPressure,
    archetypeId: house.archetypeId,
  };
}

function createSnapshotCity(city: CityState, currentTick: number): SnapshotCity {
  return {
    id: city.id,
    x: city.x,
    y: city.y,
    radius: city.radius,
    authority: 0,
    brain: createBrainSnapshot(city.brain, city.brainNodeDuration, city.brainDecision, currentTick),
    demand: { ...city.activeDemand },
    demandExpiresAt: city.demandExpiresAt,
    stockpiles: cloneResourceBundle(city.stockpiles),
    primaryLeaderId: city.primaryLeaderId,
    leaders: city.leaders.map((leader) => createSnapshotLeader(leader)),
    leaderDirectives: { ...city.leaderDirectives },
  };
}

function createSnapshotLeader(leader: CollectiveLeaderDescriptor): SnapshotLeader {
  return {
    agentId: leader.agentId,
    role: leader.role,
    title: leader.title,
    method: leader.method,
    score: leader.score,
    support: leader.support,
    selectedAtTick: leader.selectedAtTick,
    temperament: { ...leader.temperament },
    traitFlags: [...leader.traitFlags],
    notes: leader.notes,
  };
}

function createSnapshotLeadership(simulation: SimulationState): SnapshotLeadershipState {
  const houses: Record<string, SnapshotLeader[]> = {};
  for (const house of simulation.houses) {
    houses[house.id] = house.leaders.map((leader) => createSnapshotLeader(leader));
  }
  return {
    houses,
    city: simulation.city ? simulation.city.leaders.map((leader) => createSnapshotLeader(leader)) : [],
    updatedAtTick: simulation.leadership?.updatedAtTick ?? simulation.tick,
  };
}

function createSnapshotDecisions(simulation: SimulationState): SnapshotDecision[] {
  if (!trackedAgentId || !trackedAgentDecision || !trackedAgentTransition) {
    return [];
  }

  const isAgentPresent = simulation.agents.some((agent) => agent.id === trackedAgentId);
  if (!isAgentPresent) {
    return [];
  }

  return [
    {
      agent_id: trackedAgentId,
      from: trackedAgentTransition.from,
      to: trackedAgentTransition.to,
    },
  ];
}

function computeEffectiveTickDurationMs(): number {
  const interval = Number.isFinite(tickIntervalMs) ? tickIntervalMs : 500;
  const ticks = Number.isFinite(ticksPerUpdate) && ticksPerUpdate > 0 ? ticksPerUpdate : 1;
  return interval / ticks;
}

function createBrainSnapshot(
  brain: BrainState,
  nodeDuration: number,
  decision: BrainDecision | null,
  currentTick: number,
): SnapshotBrainData {
  const metadata = getCurrentNodeMetadata(brain);
  const durationTicks = Number.isFinite(nodeDuration) && nodeDuration > 0 ? nodeDuration : metadata.duration;
  const remainingTicks = Number.isFinite(brain.nodeTimer) ? Math.max(0, brain.nodeTimer) : durationTicks;
  const safeDurationTicks = durationTicks > 0 ? durationTicks : 1;
  const elapsedTicks = Math.max(0, safeDurationTicks - Math.min(remainingTicks, safeDurationTicks));
  const tickDurationMs = computeEffectiveTickDurationMs();
  const pulses = extractSnapshotBrainPulses(brain);
  const fillInfo = extractSnapshotFillRatios(brain);
  const fillRatios = fillInfo?.ratios ?? {};
  const transition: SnapshotBrainTransitionTiming = {
    durationTicks: safeDurationTicks,
    remainingTicks,
    elapsedTicks,
    startedAtTick: Math.max(0, currentTick - elapsedTicks),
    updatedAtTick: currentTick,
    tickIntervalMs,
    ticksPerUpdate,
    tickDurationMs,
  };
  return {
    summary: {
      brainId: brain.brainId,
      nodeId: brain.currentNodeId,
      nodeTimer: brain.nodeTimer,
      nodeDuration,
      decision: cloneBrainDecision(decision),
      traitFlags: [...brain.traitFlags],
      baseFrequency: metadata.baseFrequency,
      tags: [...metadata.tags],
      transition,
    },
    state: serializeBrainState(brain),
    pulses,
    fillRatios,
    nodeFill: fillInfo,
  };
}

function cloneResourceBundle(bundle: ResourceBundle | null | undefined): SnapshotResourceBundle {
  const clone: SnapshotResourceBundle = {};
  if (!bundle) {
    return clone;
  }
  for (const [key, value] of Object.entries(bundle)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    clone[key as ResourceType] = Math.max(0, numeric);
  }
  return clone;
}

function cloneAgentResourceActivity(
  activity: AgentResourceActivity | null,
): SnapshotAgentResourceActivity | null {
  if (!activity) {
    return null;
  }

  const harvested = activity.harvested ? cloneResourceBundle(activity.harvested) : null;
  const delivered = activity.delivered ? cloneResourceBundle(activity.delivered) : null;

  const hasHarvested = harvested && Object.keys(harvested).length > 0;
  const hasDelivered = delivered && Object.keys(delivered).length > 0;

  if (!hasHarvested && !hasDelivered) {
    return null;
  }

  const clone: SnapshotAgentResourceActivity = {};
  if (hasHarvested && harvested) {
    clone.harvested = harvested;
  }
  if (hasDelivered && delivered) {
    clone.delivered = delivered;
  }
  return clone;
}

function cloneHouseConstruction(construction: HouseState['construction']): SnapshotHouseConstruction {
  if (!construction) {
    return {
      active: false,
      progress: 0,
      required: HOUSE_CONSTRUCTION_COST,
      cooldownUntil: 0,
    };
  }
  const progress = Number.isFinite(construction.progress) ? Math.max(0, construction.progress) : 0;
  const required = Number.isFinite(construction.required)
    ? Math.max(1, construction.required)
    : HOUSE_CONSTRUCTION_COST;
  const cooldown = Number.isFinite(construction.cooldownUntil) ? construction.cooldownUntil : 0;
  return {
    active: Boolean(construction.active),
    progress,
    required,
    cooldownUntil: cooldown,
  };
}

function cloneBrainMultipliers(multipliers: BrainMultiplierSet): BrainMultiplierSet {
  const clone: BrainMultiplierSet = {};
  if (multipliers.mood) {
    clone.mood = { ...multipliers.mood };
  }
  if (multipliers.personality) {
    clone.personality = { ...multipliers.personality };
  }
  if (multipliers.demand) {
    clone.demand = { ...multipliers.demand };
  }
  return clone;
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
