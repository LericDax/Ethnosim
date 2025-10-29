import { findAgent, averageTemperament, jitterTemperament, createNewborn, clampTemperament } from '../core/agents.js';

const GESTATION_TICKS = 200;

/**
 * Handles conception, gestation updates, and births.
 * @param {Array} agents
 * @param {number} tick
 * @param {{cx:number,cy:number}} world
 * @param {import('../core/rng.js').RNG} rng
 * @param {Array} houses
 */
export function handleReproduction(agents, tick, world, rng, houses) {
  const newAgents = [];

  for (const agent of agents) {
    if (agent.age_stage === 'adult' && agent.sex_body === 'female' && agent.fertility > 0 && !agent.pregnant) {
      attemptConception(agent, agents, rng);
    }
  }

  for (const agent of agents) {
    if (!agent.pregnant) continue;
    agent.pregnant.time_remaining -= 1;
    const stress = computeStress(agent, world, rng);
    const fetus = agent.pregnant.fetus_temperament;
    fetus.fear_bias = clamp01(fetus.fear_bias + 0.01 * stress);
    fetus.territorial_bias = clamp01(fetus.territorial_bias + 0.005 * stress);

    if (agent.pregnant.time_remaining <= 0) {
      const newborn = createNewborn(agent, clampTemperament(fetus), rng);
      newAgents.push(newborn);
      agent.pregnant = null;
      agent.children.push(newborn.id);
      const coParent = agent.bond_partner_id ? findAgent(agents, agent.bond_partner_id) : null;
      if (coParent) {
        coParent.children = coParent.children ?? [];
        coParent.children.push(newborn.id);
      }
      if (houses) {
        const house = houses.find((h) => h.id === newborn.house_id);
        if (house) house.members.push(newborn.id);
      }
    }
  }

  if (newAgents.length) {
    agents.push(...newAgents);
  }
}

function attemptConception(agent, agents, rng) {
  if (!agent.bond_partner_id) return;
  const partner = findAgent(agents, agent.bond_partner_id);
  if (!partner || partner.age_stage !== 'adult') return;

  const roll = rng.nextFloat();
  if (roll >= 0.02 * agent.fertility) return;

  const baseTemperament = averageTemperament(agent.temperament, partner.temperament);
  const fetusTemperament = jitterTemperament(baseTemperament, rng, 0.05);
  agent.pregnant = {
    time_remaining: GESTATION_TICKS,
    fetus_temperament: fetusTemperament,
    co_parent_id: partner.id,
  };
}

function computeStress(agent, world, rng) {
  const dx = agent.x - world.cx;
  const dy = agent.y - world.cy;
  const distance = Math.hypot(dx, dy);
  const noise = rng.nextRange(0, 0.1);
  return Math.min(1, distance / 40 + noise);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
