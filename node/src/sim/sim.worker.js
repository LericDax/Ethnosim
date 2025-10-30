/** @typedef {import('../util/snapshotTypes.js').Snapshot} Snapshot */

const LIFE_STAGES = ['baby', 'child', 'teen', 'adult'];

let intervalHandle = null;
let state = null;

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
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

function initializeSimulation(message) {
  stopSimulation();

  const [width, height] = message.worldSize ?? [100, 100];
  const agentCount = Math.max(1, message.agentCount ?? 8);

  state = {
    tick: 0,
    world: { width, height },
    agents: createAgents(agentCount, width, height, message.seed),
  };

  postSnapshot();

  const intervalMs = message.intervalMs ?? 500;
  intervalHandle = setInterval(() => {
    stepSimulation();
    postSnapshot();
  }, intervalMs);
}

function stopSimulation() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state = null;
}

function stepSimulation() {
  if (!state) return;
  state.tick += 1;
  const t = state.tick;
  const radius = Math.min(state.world.width, state.world.height) * 0.45;
  const centerX = state.world.width / 2;
  const centerY = state.world.height / 2;

  state.agents.forEach((agent, index) => {
    const angle = (t / 40 + index / state.agents.length) * Math.PI * 2;
    agent.x = centerX + Math.cos(angle) * radius;
    agent.y = centerY + Math.sin(angle) * radius;
  });
}

function postSnapshot() {
  if (!state) return;
  /** @type {Snapshot} */
  const snapshot = {
    type: 'SNAPSHOT',
    version: 1,
    tick: state.tick,
    world: { width: state.world.width, height: state.world.height },
    agents: state.agents.map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      lifeStage: agent.lifeStage,
    })),
    houses: [],
    city: null,
  };
  postMessage(snapshot);
}

function createAgents(count, width, height, seed) {
  const rng = seededRandom(seed);
  const agents = [];
  for (let i = 0; i < count; i += 1) {
    agents.push({
      id: `agent-${i}`,
      x: rng() * width,
      y: rng() * height,
      lifeStage: LIFE_STAGES[i % LIFE_STAGES.length],
    });
  }
  return agents;
}

function seededRandom(seed) {
  let stateValue = typeof seed === 'number' ? seed >>> 0 : 0x6d2b79f5;
  if (stateValue === 0) {
    stateValue = 0x6d2b79f5;
  }

  return () => {
    // xorshift32
    stateValue ^= stateValue << 13;
    stateValue ^= stateValue >>> 17;
    stateValue ^= stateValue << 5;
    return (stateValue >>> 0) / 0xffffffff;
  };
}
