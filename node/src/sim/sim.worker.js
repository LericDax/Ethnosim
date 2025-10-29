import { createRng } from './core/rng.js';
import { initWorld } from './core/world.js';
import { initBrains } from './core/brains.js';
import { spawnInitialAdults } from './core/agents.js';
import { tickAllBrains } from './systems/tickBrain.js';
import { moveAllAgents } from './systems/move.js';
import { handleReproduction } from './systems/repro.js';
import { applyAging } from './systems/aging.js';
import { tickCollectives } from './systems/collectives.js';

let rng;
let world;
let agents = [];
let houses = [];
let city = null;
let tick = 0;
let ticksPerUpdate = 4;
let seed = 1;
let loopHandle = null;
let activeDemands = [];

initBrains();

self.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg?.type) {
    case 'INIT':
      initializeSimulation(msg);
      break;
    case 'SET_TICKS_PER_UPDATE':
      ticksPerUpdate = Math.max(1, msg.value | 0);
      break;
    case 'STOP':
      stopLoop();
      break;
    default:
      break;
  }
});

function initializeSimulation(msg) {
  stopLoop();
  seed = msg.seed ?? 1;
  const [width, height] = msg.worldSize ?? [100, 100];
  world = initWorld(width, height);
  rng = createRng(seed);
  const initial = spawnInitialAdults(rng, world, msg.adults ?? 6);
  agents = initial.agents;
  houses = initial.houses;
  city = initial.city;
  ticksPerUpdate = msg.ticksPerUpdate ?? ticksPerUpdate;
  tick = 0;
  activeDemands = [];

  const interval = msg.intervalMs ?? 50;
  loopHandle = setInterval(runStepBundle, interval);
  postMessage(buildSnapshot());
}

function stopLoop() {
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function runStepBundle() {
  for (let i = 0; i < ticksPerUpdate; i++) {
    stepOneTick();
  }
  postMessage(buildSnapshot());
}

function stepOneTick() {
  handleReproduction(agents, tick, world, rng, houses);
  tickAllBrains(agents, houses, city, tick, world, rng, activeDemands);
  moveAllAgents(agents, houses, world, rng);
  applyAging(agents, rng);
  activeDemands = tickCollectives(houses, city, agents, tick, world, rng, activeDemands);
  tick += 1;
}

function buildSnapshot() {
  return {
    type: 'SNAPSHOT',
    seed,
    tick,
    world: { w: world.w, h: world.h },
    agents: agents.map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      age_stage: agent.age_stage,
      brain_node: agent.brain?.current_node ?? null,
      house_id: agent.house_id,
      pregnant: Boolean(agent.pregnant),
    })),
    houses: houses.map((house) => ({
      id: house.id,
      x: house.x,
      y: house.y,
      authority: house.authority,
      members: [...house.members],
      brain_node: house.brain?.current_node ?? null,
    })),
    city: city
      ? {
          id: city.id,
          x: city.x,
          y: city.y,
          authority: city.authority,
          brain_node: city.brain?.current_node ?? null,
        }
      : null,
    demands: activeDemands,
    stats: summarizeStages(agents),
  };
}

function summarizeStages(list) {
  const counts = { baby: 0, child: 0, teen: 0, adult: 0 };
  for (const agent of list) {
    if (counts[agent.age_stage] !== undefined) {
      counts[agent.age_stage] += 1;
    }
  }
  return counts;
}
