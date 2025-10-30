import { createSeededRng, type SeededRng, type RngStream } from './engine/rng.ts';
import {
  createBrainState,
  tickBrain,
  type BrainState,
  type BrainDecision,
  type BrainMultiplierSet,
  getCurrentNodeMetadata,
  serializeBrainState,
  cloneBrainDecision,
  type SerializedBrainState,
} from './engine/brain.ts';
import { moveAgent, type MovableAgent, type MovementContext } from './engine/move.ts';
import { createWorld, type WorldState } from './engine/world.ts';
import { handleReproduction } from './engine/repro.ts';
import { createTraitProfile } from './engine/traits.ts';
import {
  assignAgentsToHouses,
  createInitialHouses,
  createUrbanCenter,
  updateCollectiveDemands,
  type HouseAssignableAgent,
  type HouseState,
  type CityState,
} from './engine/collectives.ts';
import {
  stepAging,
  STAGE_BASE_SPEED,
  STAGE_BRAIN_IDS,
  STAGE_LIMITS,
} from './engine/aging.ts';
import { resolveScenario, scenarioToSimulationDefaults } from './data/scenarios.ts';

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

export interface AgentState extends MovableAgent, HouseAssignableAgent {
  ageTicks: number;
  sexBody: 'male' | 'female';
  genderIdentity: 'man' | 'woman' | 'nonbinary';
  fertility: number;
  pregnancy: PregnancyState | null;
  bondPartnerId: string | null;
  parents: string[];
  temperament: Temperament;
  traitFlags: string[];
  moods: Record<string, number>;
  brainNodeDuration: number;
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
  scenarioId: string;
  seed: string;
}

export interface SimulationConfig {
  worldSize?: [number, number];
  agentCount?: number;
  seed?: number | string | bigint | null;
  scenarioId?: string | null;
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
}

interface SnapshotBrainData {
  summary: SnapshotBrainSummary;
  state: SerializedBrainState;
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
  sexBody: AgentState['sexBody'];
  genderIdentity: AgentState['genderIdentity'];
  bondPartnerId: string | null;
  parents: string[];
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
  stats: StageCounts;
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

type WorkerMessage =
  | WorkerInitMessage
  | WorkerStopMessage
  | WorkerPauseMessage
  | WorkerResumeMessage
  | WorkerSetTickIntervalMessage
  | WorkerSetTicksPerUpdateMessage
  | WorkerRequestSnapshotMessage;

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
}

function postSnapshot(): void {
  if (!workerContext || !state) {
    return;
  }
  workerContext.postMessage(createSnapshot(state));
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
  const agents = createAgents(agentCount, width, height, agentStream);
  const houses = createInitialHouses({
    width,
    height,
    rng: collectivesStream,
    agents,
  });
  const city = createUrbanCenter({
    width,
    height,
    rng: collectivesStream,
  });
  const stageCounts = computeStageCounts(agents);

  return {
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
    scenarioId,
    seed: seedString,
  };
}

function createAgents(count: number, width: number, height: number, stream: RngStream): AgentState[] {
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
    const sexBody = stream.nextFloat() < 0.5 ? 'female' : 'male';
    const genderIdentity = sampleGenderIdentity(stream.nextFloat());
    const fertility =
      lifeStage === 'adult' && sexBody === 'female' ? 0.4 + stream.nextFloat() * 0.5 : 0;
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
      sexBody,
      genderIdentity,
      fertility,
      pregnancy: null,
      bondPartnerId: null,
      parents: [],
      temperament,
      traitFlags: [...traitProfile.traitFlags],
      moods: buildInitialMoodState(traitProfile),
      houseId: null,
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

  const adultFemales = adults.filter((agent) => agent.sexBody === 'female');
  const adultMales = adults.filter((agent) => agent.sexBody === 'male');
  shuffleInPlace(adultFemales, stream);
  shuffleInPlace(adultMales, stream);
  const pairCount = Math.min(adultFemales.length, adultMales.length);
  for (let i = 0; i < pairCount; i += 1) {
    const female = adultFemales[i];
    const male = adultMales[i];
    female.bondPartnerId = male.id;
    male.bondPartnerId = female.id;
  }

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
  if (Object.keys(profile.moodLevels).length === 0) {
    return {};
  }
  return { ...profile.moodLevels };
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

  handleReproduction(simulation);

  assignAgentsToHouses(simulation.houses, simulation.agents);
  updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick);

  simulation.agents.forEach((agent) => {
    const brainResult = tickBrain(agent.brain, agent.brainMultipliers, agent.moods);
    agent.brainNodeDuration = brainResult.nodeDuration;
    agent.brainDecision = brainResult.decision;
  });

  const agentsById = new Map<string, AgentState>();
  simulation.agents.forEach((agent) => {
    agentsById.set(agent.id, agent);
  });

  const movementContext: MovementContext = {
    world: simulation.world,
    agentsById,
  };

  simulation.agents.forEach((agent) => {
    moveAgent(agent, movementContext, simulation.rng.tick);
  });

  stepAging(simulation);

  simulation.stageCounts = computeStageCounts(simulation.agents);
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
    agents: simulation.agents.map((agent) => createSnapshotAgent(agent)),
    houses: simulation.houses.map((house) => createSnapshotHouse(house)),
    city: simulation.city ? createSnapshotCity(simulation.city) : null,
    demands: [],
    stats: { ...simulation.stageCounts },
  };
}

function createSnapshotAgent(agent: AgentState): SnapshotAgent {
  return {
    id: agent.id,
    x: agent.x,
    y: agent.y,
    lifeStage: agent.lifeStage,
    ageStage: agent.lifeStage,
    brainNode: agent.brain.currentNodeId,
    brain: createBrainSnapshot(agent.brain, agent.brainNodeDuration, agent.brainDecision),
    houseId: agent.houseId ?? null,
    pregnant: Boolean(agent.pregnancy),
    fertility: agent.fertility,
    moods: { ...agent.moods },
    brainMultipliers: cloneBrainMultipliers(agent.brainMultipliers),
    traitFlags: [...agent.traitFlags],
    temperament: { ...agent.temperament },
    ageTicks: agent.ageTicks,
    speed: agent.speed,
    sexBody: agent.sexBody,
    genderIdentity: agent.genderIdentity,
    bondPartnerId: agent.bondPartnerId,
    parents: [...agent.parents],
  };
}

function createSnapshotHouse(house: HouseState): SnapshotHouse {
  return {
    id: house.id,
    x: house.x,
    y: house.y,
    radius: house.radius,
    members: [...house.members],
    authority: 0,
    brain: createBrainSnapshot(house.brain, house.brainNodeDuration, house.brainDecision),
    demand: { ...house.activeDemand },
  };
}

function createSnapshotCity(city: CityState): SnapshotCity {
  return {
    id: city.id,
    x: city.x,
    y: city.y,
    radius: city.radius,
    authority: 0,
    brain: createBrainSnapshot(city.brain, city.brainNodeDuration, city.brainDecision),
    demand: { ...city.activeDemand },
    demandExpiresAt: city.demandExpiresAt,
  };
}

function createBrainSnapshot(
  brain: BrainState,
  nodeDuration: number,
  decision: BrainDecision | null,
): SnapshotBrainData {
  const metadata = getCurrentNodeMetadata(brain);
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
    },
    state: serializeBrainState(brain),
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
