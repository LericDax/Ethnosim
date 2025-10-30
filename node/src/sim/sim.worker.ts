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

type LifeStage = MovableAgent['lifeStage'];

interface AgentState extends MovableAgent {
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
  };
}

function createAgents(count: number, width: number, height: number, stream: RngStream): AgentState[] {
  const agents: AgentState[] = [];
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const homeRadius = Math.min(width, height) * 0.1;
  for (let i = 0; i < count; i += 1) {
    const brain = createBrainState('AdultMind_v1');
    const brainMetadata = getCurrentNodeMetadata(brain);
    const lifeStage = LIFE_STAGES[i % LIFE_STAGES.length];
    agents.push({
      id: `agent-${i}`,
      x: stream.nextFloat() * width,
      y: stream.nextFloat() * height,
      lifeStage,
      speed: 0.4 + stream.nextFloat() * 0.6,
      homeX: centerX + (stream.nextFloat() - 0.5) * homeRadius,
      homeY: centerY + (stream.nextFloat() - 0.5) * homeRadius,
      caregiverId: null,
      explorationBias: stream.nextFloat(),
      brain,
      brainMultipliers: {},
      brainNodeDuration: brainMetadata.duration,
      brainDecision: null,
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
        agent.speed = 0;
      }
    }
  });
  return agents;
}

export function stepSimulationState(simulation: SimulationState): void {
  simulation.tick += 1;

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
