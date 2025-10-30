import { createBrainState, getCurrentNodeMetadata } from './brain.ts';
import { STAGE_BASE_SPEED, STAGE_BRAIN_IDS } from './aging.ts';
import type { AgentState, SimulationState, Temperament } from '../sim.worker.ts';
import type { RngStream } from './rng.ts';
import { createFetusTemperament, applyGestationalStress } from './temperament.ts';

const CONCEPTION_RATE_MULTIPLIER = 0.02;
export const GESTATION_TICKS = 200;

export function handleReproduction(simulation: SimulationState): void {
  const rng = simulation.rng.tick;
  const agentsById = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    agentsById.set(agent.id, agent);
  }

  const newborns: AgentState[] = [];
  const newPregnancies = new Set<string>();

  for (const agent of simulation.agents) {
    if (
      agent.lifeStage !== 'adult' ||
      agent.sexBody !== 'female' ||
      agent.fertility <= 0 ||
      agent.pregnancy ||
      !agent.bondPartnerId
    ) {
      continue;
    }

    const partner = agentsById.get(agent.bondPartnerId);
    if (!partner) {
      continue;
    }

    const roll = rng.nextFloat();
    const chance = agent.fertility * CONCEPTION_RATE_MULTIPLIER;
    if (roll < chance) {
      const fetusTemperament = createFetusTemperament(agent.temperament, partner.temperament, rng);
      agent.pregnancy = {
        timeRemaining: GESTATION_TICKS,
        fetusTemperament,
        coParentId: partner.id,
      };
      newPregnancies.add(agent.id);
    }
  }

  for (const agent of simulation.agents) {
    if (!agent.pregnancy) {
      continue;
    }

    if (newPregnancies.has(agent.id)) {
      continue;
    }

    progressGestation(agent, simulation, rng);

    if (agent.pregnancy && agent.pregnancy.timeRemaining <= 0) {
      const baby = createNewborn(simulation, agent);
      newborns.push(baby);
      agent.pregnancy = null;
    }
  }

  if (newborns.length > 0) {
    simulation.agents.push(...newborns);
  }
}

function progressGestation(agent: AgentState, simulation: SimulationState, rng: RngStream): void {
  const pregnancy = agent.pregnancy;
  if (!pregnancy) {
    return;
  }

  pregnancy.timeRemaining -= 1;
  if (pregnancy.timeRemaining < 0) {
    pregnancy.timeRemaining = 0;
  }
  const stress = computeGestationalStress(agent, simulation, rng);
  applyGestationalStress(pregnancy.fetusTemperament, stress);

  if (pregnancy.timeRemaining > 0) {
    return;
  }
}

function computeGestationalStress(agent: AgentState, simulation: SimulationState, rng: RngStream): number {
  const dx = agent.x - simulation.world.centerX;
  const dy = agent.y - simulation.world.centerY;
  const distance = Math.hypot(dx, dy);
  const base = distance / 40;
  const noise = rng.nextFloat() * 0.1;
  return Math.min(1, base + noise);
}

function createNewborn(simulation: SimulationState, parent: AgentState): AgentState {
  const pregnancy = parent.pregnancy;
  const fetusTemperament = pregnancy?.fetusTemperament ?? parent.temperament;
  const temperament: Temperament = {
    trustBias: fetusTemperament.trustBias,
    fearBias: fetusTemperament.fearBias,
    loyaltyBias: fetusTemperament.loyaltyBias,
    resentmentBias: fetusTemperament.resentmentBias,
    territorialBias: fetusTemperament.territorialBias,
    zealBias: fetusTemperament.zealBias,
  };

  const id = `agent-${simulation.nextAgentId}`;
  simulation.nextAgentId += 1;

  const sexBody = simulation.rng.tick.nextFloat() < 0.5 ? 'female' : 'male';
  const genderRoll = simulation.rng.tick.nextFloat();
  const genderIdentity = genderRoll < 0.4 ? 'man' : genderRoll < 0.8 ? 'woman' : 'nonbinary';

  const brain = createBrainState(STAGE_BRAIN_IDS.baby);
  const brainMetadata = getCurrentNodeMetadata(brain);

  const parents: string[] = [parent.id];
  if (pregnancy?.coParentId && pregnancy.coParentId !== parent.id) {
    parents.push(pregnancy.coParentId);
  }

  return {
    id,
    x: parent.x,
    y: parent.y,
    lifeStage: 'baby',
    ageTicks: 0,
    speed: STAGE_BASE_SPEED.baby,
    homeX: parent.homeX,
    homeY: parent.homeY,
    caregiverId: parent.id,
    explorationBias: simulation.rng.tick.nextFloat(),
    brain,
    brainMultipliers: {},
    brainNodeDuration: brainMetadata.duration,
    brainDecision: null,
    sexBody,
    genderIdentity,
    fertility: 0,
    pregnancy: null,
    bondPartnerId: null,
    parents,
    temperament,
    houseId: parent.houseId,
  };
}
