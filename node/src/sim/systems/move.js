import { getBrainGraph } from '../core/brains.js';
import { findAgent } from '../core/agents.js';

/**
 * Moves each agent one step according to their current brain node and life stage.
 * @param {Array} agents
 * @param {Array} houses
 * @param {{w:number,h:number,cx:number,cy:number}} world
 * @param {import('../core/rng.js').RNG} rng
 */
export function moveAllAgents(agents, houses, world, rng) {
  for (const agent of agents) {
    const brain = agent.brain;
    if (!brain) continue;
    const graph = getBrainGraph(brain.graph_name);
    const node = graph.nodesById.get(brain.current_node);
    const tags = node?.tags ?? [];
    const hasTag = (tag) => tags.includes(tag);

    let target;
    if (agent.age_stage === 'baby') {
      target = locateCareAnchor(agent, agents, houses, world);
    } else if (agent.age_stage === 'child') {
      target = locateCareAnchor(agent, agents, houses, world);
      if (hasTag('outward') || hasTag('curiosity')) {
        target = pushOutward(agent, world, 2);
      }
    } else if (agent.age_stage === 'teen') {
      if (hasTag('outward') || hasTag('risk') || hasTag('border')) {
        target = pushOutward(agent, world, 4);
      } else if (hasTag('social') || hasTag('bonding') || hasTag('loyalty')) {
        target = locateHouse(agent, houses) ?? { x: world.cx, y: world.cy };
      } else {
        target = jitter(agent, rng);
      }
    } else {
      // adult
      if (hasTag('outward') || hasTag('work') || hasTag('guard') || hasTag('border')) {
        target = pushOutward(agent, world, 5);
      } else if (hasTag('home') || hasTag('inward') || hasTag('rest') || hasTag('social') || hasTag('care')) {
        target = locateHouse(agent, houses) ?? { x: world.cx, y: world.cy };
      } else {
        target = jitter(agent, rng);
      }
    }

    if (!target) target = jitter(agent, rng);
    stepToward(agent, target, world, rng, agent.age_stage === 'baby');
  }
}

function locateCareAnchor(agent, agents, houses, world) {
  if (agent.primary_caregiver_id) {
    const caregiver = findAgent(agents, agent.primary_caregiver_id);
    if (caregiver) {
      return { x: caregiver.x, y: caregiver.y };
    }
  }
  return locateHouse(agent, houses) ?? { x: world.cx, y: world.cy };
}

function locateHouse(agent, houses) {
  if (!houses) return null;
  return houses.find((h) => h.id === agent.house_id) ?? null;
}

function pushOutward(agent, world, strength = 3) {
  const dx = agent.x - world.cx;
  const dy = agent.y - world.cy;
  const mag = Math.hypot(dx, dy) || 1;
  return {
    x: agent.x + (dx / mag) * strength,
    y: agent.y + (dy / mag) * strength,
  };
}

function jitter(agent, rng) {
  return {
    x: agent.x + rng.nextRange(-2, 2),
    y: agent.y + rng.nextRange(-2, 2),
  };
}

function stepToward(agent, target, world, rng, anchor) {
  let dx = target.x - agent.x;
  let dy = target.y - agent.y;
  if (anchor) {
    dx *= 0.3;
    dy *= 0.3;
  }
  dx = clampStep(dx + rng.nextRange(-0.2, 0.2));
  dy = clampStep(dy + rng.nextRange(-0.2, 0.2));

  agent.x = clamp(Math.round(agent.x + dx), 0, world.w - 1);
  agent.y = clamp(Math.round(agent.y + dy), 0, world.h - 1);
}

function clampStep(value) {
  if (value > 0.5) return 1;
  if (value < -0.5) return -1;
  return 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
