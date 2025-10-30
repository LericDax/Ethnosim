import { createSeededRng, type SeededRng, type RngStream } from './engine/rng.ts';

type LifeStage = 'baby' | 'child' | 'teen' | 'adult';

interface AgentState {
  id: string;
  x: number;
  y: number;
  lifeStage: LifeStage;
  orbitOffset: number;
  orbitSpeed: number;
  radialBias: number;
}

interface WorldState {
  width: number;
  height: number;
  climateSeed: number;
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

function createWorld(width: number, height: number, stream: RngStream): WorldState {
  return {
    width,
    height,
    climateSeed: stream.nextFloat(),
  };
}

function createAgents(count: number, width: number, height: number, stream: RngStream): AgentState[] {
  const agents: AgentState[] = [];
  for (let i = 0; i < count; i += 1) {
    agents.push({
      id: `agent-${i}`,
      x: stream.nextFloat() * width,
      y: stream.nextFloat() * height,
      lifeStage: LIFE_STAGES[i % LIFE_STAGES.length],
      orbitOffset: stream.nextFloat() * Math.PI * 2,
      orbitSpeed: 0.8 + stream.nextFloat() * 0.4,
      radialBias: 0.6 + stream.nextFloat() * 0.3,
    });
  }
  return agents;
}

export function stepSimulationState(simulation: SimulationState): void {
  simulation.tick += 1;
  const t = simulation.tick;
  const radiusBase = Math.min(simulation.world.width, simulation.world.height) * 0.45;
  const centerX = simulation.world.width / 2;
  const centerY = simulation.world.height / 2;
  const globalRotation = (simulation.rng.tick.nextFloat() - 0.5) * 0.2;

  simulation.agents.forEach((agent, index) => {
    const radius = radiusBase * agent.radialBias;
    const baseAngle = (t / 40 + index / simulation.agents.length) * Math.PI * 2;
    const angle = baseAngle * agent.orbitSpeed + agent.orbitOffset + globalRotation;
    agent.x = centerX + Math.cos(angle) * radius;
    agent.y = centerY + Math.sin(angle) * radius;
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
    })),
    houses: [],
    city: null,
  };
}
