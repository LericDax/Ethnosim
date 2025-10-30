import { createSeededRng, type SeededRng, type RngStream } from './engine/rng.ts';
import {
  createBrainState,
  tickBrain,
  type BrainState,
  type BrainMultiplierSet,
  type BrainDecision,
  getCurrentNodeMetadata,
} from './engine/brain.ts';
import { moveAgent, type MovableAgent, type MovementContext } from './engine/move.ts';
import { createWorld, type WorldState } from './engine/world.ts';
import { handleReproduction } from './engine/repro.ts';
import {
  stepAging,
  STAGE_BASE_SPEED,
  STAGE_BRAIN_IDS,
  STAGE_LIMITS,
} from './engine/aging.ts';

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

export interface AgentState extends MovableAgent {
  ageTicks: number;
  sexBody: 'male' | 'female';
  genderIdentity: 'man' | 'woman' | 'nonbinary';
  fertility: number;
  pregnancy: PregnancyState | null;
  bondPartnerId: string | null;
  parents: string[];
  temperament: Temperament;
  brainMultipliers: BrainMultiplierSet;
  brainNodeDuration: number;
}

interface SimulationRng {
  root: SeededRng;
  world: RngStream;
  agentSpawn: RngStream;
  tick: RngStream;
}

export interface SimulationState {
  tick: number;
  world: WorldState;
  agents: AgentState[];
  rng: SimulationRng;
  stageCounts: StageCounts;
  nextAgentId: number;
}

export interface SimulationConfig {
  worldSize: [number, number];
  agentCount: number;
  seed?: number | string | bigint | null;
}

interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
  lifeStage: LifeStage;
  brain: SnapshotAgentBrain;
}

interface SnapshotAgentBrain {
  brainId: string;
  nodeId: string;
  nodeTimer: number;
  nodeDuration: number;
  baseFrequency: number;
  tags: string[];
  decision: BrainDecision | null;
}

export interface Snapshot {
  type: 'SNAPSHOT';
  version: number;
  tick: number;
  world: { width: number; height: number };
  agents: SnapshotAgent[];
  houses: [];
  city: null;
  stats: StageCounts;
}

interface WorkerInitMessage {
  type: 'INIT';
  worldSize?: [number, number];
  agentCount?: number;
  seed?: number | string | bigint | null;
  intervalMs?: number;
}

interface WorkerStopMessage {
  type: 'STOP';
}

type WorkerMessage = WorkerInitMessage | WorkerStopMessage;

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
      default:
        break;
    }
  });
}

function initializeSimulation(message: WorkerInitMessage): void {
  stopSimulation();

  const worldSize = message.worldSize ?? [100, 100];
  const agentCount = Math.max(1, message.agentCount ?? 8);

  state = createSimulationState({
    worldSize: worldSize as [number, number],
    agentCount,
    seed: message.seed,
  });

  postSnapshot();

  const intervalMs = message.intervalMs ?? 500;
  intervalHandle = setInterval(() => {
    if (!state) {
      return;
    }
    stepSimulationState(state);
    postSnapshot();
  }, intervalMs);
}

function stopSimulation(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state = null;
}

function postSnapshot(): void {
  if (!workerContext || !state) {
    return;
  }
  workerContext.postMessage(createSnapshot(state));
}

export function createSimulationState(config: SimulationConfig): SimulationState {
  const [width, height] = config.worldSize;
  const rootRng = createSeededRng(config.seed);
  const worldStream = rootRng.stream('world');
  const agentStream = rootRng.stream('agent-spawn');
  const tickStream = rootRng.stream('tick');

  const world = createWorld(width, height, worldStream);
  const agents = createAgents(config.agentCount, width, height, agentStream);
  const stageCounts = computeStageCounts(agents);

  return {
    tick: 0,
    world,
    agents,
    rng: {
      root: rootRng,
      world: worldStream,
      agentSpawn: agentStream,
      tick: tickStream,
    },
    stageCounts,
    nextAgentId: agents.length,
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
    const brainMetadata = getCurrentNodeMetadata(brain);
    const sexBody = stream.nextFloat() < 0.5 ? 'female' : 'male';
    const genderIdentity = sampleGenderIdentity(stream.nextFloat());
    const fertility =
      lifeStage === 'adult' && sexBody === 'female' ? 0.4 + stream.nextFloat() * 0.5 : 0;
    const temperament = createRandomTemperament(stream);
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
      brainMultipliers: {},
      brainNodeDuration: brainMetadata.duration,
      brainDecision: null,
      sexBody,
      genderIdentity,
      fertility,
      pregnancy: null,
      bondPartnerId: null,
      parents: [],
      temperament,
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

function createRandomTemperament(stream: RngStream): Temperament {
  return {
    trustBias: clamp01(0.2 + stream.nextFloat() * 0.6),
    fearBias: clamp01(0.2 + stream.nextFloat() * 0.6),
    loyaltyBias: clamp01(0.2 + stream.nextFloat() * 0.6),
    resentmentBias: clamp01(0.2 + stream.nextFloat() * 0.6),
    territorialBias: clamp01(0.2 + stream.nextFloat() * 0.6),
    zealBias: clamp01(0.2 + stream.nextFloat() * 0.6),
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

  simulation.agents.forEach((agent) => {
    const brainResult = tickBrain(agent.brain, agent.brainMultipliers);
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

export function createSnapshot(simulation: SimulationState): Snapshot {
  return {
    type: 'SNAPSHOT',
    version: 1,
    tick: simulation.tick,
    world: { width: simulation.world.width, height: simulation.world.height },
    agents: simulation.agents.map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      lifeStage: agent.lifeStage,
      brain: createSnapshotBrain(agent),
    })),
    houses: [],
    city: null,
    stats: { ...simulation.stageCounts },
  };
}

function createSnapshotBrain(agent: AgentState): SnapshotAgentBrain {
  const metadata = getCurrentNodeMetadata(agent.brain);
  const decision = agent.brainDecision
    ? {
        fromNodeId: agent.brainDecision.fromNodeId,
        chosenNodeId: agent.brainDecision.chosenNodeId,
        candidates: agent.brainDecision.candidates.map((candidate) => ({
          nodeId: candidate.nodeId,
          desirability: candidate.desirability,
          edgeWeight: candidate.edgeWeight,
          baseFrequency: candidate.baseFrequency,
          moodMultiplier: candidate.moodMultiplier,
          personalityMultiplier: candidate.personalityMultiplier,
          demandMultiplier: candidate.demandMultiplier,
          tags: [...candidate.tags],
        })),
      }
    : null;

  return {
    brainId: agent.brain.brainId,
    nodeId: agent.brain.currentNodeId,
    nodeTimer: agent.brain.nodeTimer,
    nodeDuration: agent.brainNodeDuration,
    baseFrequency: metadata.baseFrequency,
    tags: [...metadata.tags],
    decision,
  };
}
