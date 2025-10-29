import { onControl, onInit, postSnapshot } from '../util/messageBus.js';

/** @typedef {import('../util/snapshotTypes.js').Snapshot} Snapshot */
/** @typedef {import('../util/snapshotTypes.js').SnapshotAgent} SnapshotAgent */

const DEFAULT_CONFIG = {
  seed: 42,
  worldSize: [100, 100],
  adults: 6,
  ticksPerUpdate: 4,
};

const state = {
  config: { ...DEFAULT_CONFIG },
  tick: 0,
  running: false,
  intervalId: /** @type {ReturnType<typeof setInterval>|null} */ (null),
  baseAgents: /** @type {SnapshotAgent[]} */ ([]),
};

function createRng(seed) {
  let a = seed | 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initializeAgents(config) {
  const rng = createRng(config.seed ?? DEFAULT_CONFIG.seed);
  const [width, height] = config.worldSize;
  const agents = [];
  for (let i = 0; i < config.adults; i += 1) {
    const id = `agent-${i + 1}`;
    const baseAngle = rng() * Math.PI * 2;
    const moodBase = rng();
    agents.push({
      id,
      lifeStage: 'adult',
      x: width / 2 + Math.cos(baseAngle) * (4 + i * 0.5),
      y: height / 2 + Math.sin(baseAngle) * (4 + i * 0.5),
      moods: {
        morale: 0.5 + (moodBase - 0.5) * 0.4,
        stress: 0.3 + (rng() - 0.5) * 0.3,
        loyalty: 0.5 + (rng() - 0.5) * 0.3,
      },
      bonds: {
        householdId: `house-${(i % 2) + 1}`,
        pairBondId: i % 2 === 1 ? `agent-${i}` : i + 1 < config.adults ? `agent-${i + 2}` : null,
        dependents: [],
      },
      movementAngle: baseAngle,
      speedTilesPerTick: 0.25 + rng() * 0.15,
    });
  }
  return agents;
}

function getHouseholds(agents) {
  const households = new Map();
  for (const agent of agents) {
    const id = agent.bonds.householdId ?? 'house-1';
    if (!households.has(id)) {
      households.set(id, {
        id,
        name: id === 'house-1' ? 'First Hearth' : 'Second Hearth',
        centroid: { x: agent.x, y: agent.y },
        moods: {
          cohesion: 0.6,
          wealth: 0.4,
          devotion: 0.5,
        },
        members: [],
        tribute: { tributeOwed: 4, tributePaid: 1 },
      });
    }
    households.get(id).members.push({
      agentId: agent.id,
      role: 'member',
    });
  }
  return Array.from(households.values());
}

function updateAgentKinematics(agent, tick, worldSize) {
  const [width, height] = worldSize;
  const radius = 8 + agent.id.length;
  const angle = agent.movementAngle + tick * 0.01;
  return {
    ...agent,
    x: width / 2 + Math.cos(angle) * radius,
    y: height / 2 + Math.sin(angle) * radius,
    moods: {
      ...agent.moods,
      morale: Math.max(0, Math.min(1, agent.moods.morale + Math.sin(tick / 20 + agent.id.length) * 0.01)),
      stress: Math.max(0, Math.min(1, agent.moods.stress + Math.cos(tick / 25 + agent.id.length) * 0.01)),
    },
    movementAngle: angle,
  };
}

function buildCity(houses, worldSize) {
  const [width, height] = worldSize;
  return {
    id: 'city-1',
    name: 'SeedTown',
    seat: { x: width / 2, y: height / 2 },
    moods: {
      stability: 0.55,
      unrest: 0.25,
      ambition: 0.45,
    },
    households: houses.map((house) => house.id),
    resources: {
      foodStores: 18,
      influence: 12,
    },
  };
}

function publishSnapshot() {
  const { config, tick, baseAgents } = state;
  const agents = baseAgents.map((agent) =>
    updateAgentKinematics(agent, tick, config.worldSize)
  );
  const houses = getHouseholds(agents);
  const snapshot = {
    tick,
    seed: config.seed,
    worldSize: config.worldSize,
    ticksPerUpdate: config.ticksPerUpdate,
    agents,
    houses,
    city: buildCity(houses, config.worldSize),
    meta: { generatedAt: Date.now() },
  };
  postSnapshot(self, snapshot);
}

function startLoop() {
  if (state.running) return;
  state.running = true;
  const step = Math.max(1, state.config.ticksPerUpdate | 0);
  state.intervalId = setInterval(() => {
    state.tick += step;
    publishSnapshot();
  }, 250);
}

function stopLoop() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
  }
  state.intervalId = null;
  state.running = false;
}

onInit(self, (payload) => {
  state.config = { ...DEFAULT_CONFIG, ...payload };
  state.tick = 0;
  state.baseAgents = initializeAgents(state.config);
  publishSnapshot();
  startLoop();
});

onControl(self, (command) => {
  if (command === 'pause') {
    stopLoop();
  } else if (command === 'resume') {
    startLoop();
  } else if (command === 'step') {
    stopLoop();
    state.tick += Math.max(1, state.config.ticksPerUpdate | 0);
    publishSnapshot();
  }
});
