import { describe, expect, it } from 'vitest';
import {
  createSimulationState,
  stepSimulationState,
  type AgentState,
} from '../src/sim/sim.worker.ts';
import {
  ensureRelationshipState,
  updateRelationshipMultipliers,
} from '../src/sim/engine/relationships.ts';

function getAdultAgent(simulation: ReturnType<typeof createSimulationState>): AgentState {
  const adult = simulation.agents.find((agent) => agent.lifeStage === 'adult');
  if (!adult) {
    throw new Error('Expected at least one adult agent in simulation');
  }
  return adult;
}

describe('housing mood pressures', () => {
  it('increases the unhoused mood and pushes adults toward building housing tasks', () => {
    const simulation = createSimulationState({
      agentCount: 6,
      worldSize: [24, 24],
      seed: 'housing-mood-regression',
    });

    const adult = getAdultAgent(simulation);

    simulation.houses = [];
    simulation.pendingHouseAssignments = [];
    simulation.agents.forEach((agent) => {
      agent.houseId = null;
    });

    adult.brain.currentNodeId = 'Rest';
    adult.brain.nodeTimer = 0;
    adult.brainDecision = null;

    const moodLevels: number[] = [];
    let buildDwellingChosen = false;

    for (let i = 0; i < 60; i += 1) {
      stepSimulationState(simulation);
      const currentMood = adult.moods?.unhoused ?? 0;
      moodLevels.push(currentMood);
      if (
        adult.brain.currentNodeId === 'BuildDwelling' ||
        adult.brainDecision?.chosenNodeId === 'BuildDwelling'
      ) {
        buildDwellingChosen = true;
      }
    }

    expect(moodLevels[0]).toBeGreaterThan(0);
    expect(moodLevels[moodLevels.length - 1]).toBeGreaterThan(moodLevels[0]);
    expect(buildDwellingChosen).toBe(true);
  });

  it('keeps BuildDwelling reachable even with strong relationship pressure', () => {
    const simulation = createSimulationState({
      agentCount: 6,
      worldSize: [24, 24],
      seed: 'housing-mood-relationships',
    });

    const adult = getAdultAgent(simulation);

    simulation.houses = [];
    simulation.pendingHouseAssignments = [];
    simulation.agents.forEach((agent) => {
      agent.houseId = null;
    });

    adult.brain.currentNodeId = 'Rest';
    adult.brain.nodeTimer = 0;
    adult.brainDecision = null;

    const relationshipState = ensureRelationshipState(adult);
    relationshipState.weights['longterm-partner'] = {
      trust: 1.25,
      obligation: 1.4,
      rivalry: 0,
    };
    updateRelationshipMultipliers(adult);

    expect(adult.brainMultipliers.relationship?.build ?? 1).toBeGreaterThan(1);

    let buildDwellingChosen = false;
    for (let i = 0; i < 60; i += 1) {
      stepSimulationState(simulation);
      if (
        adult.brain.currentNodeId === 'BuildDwelling' ||
        adult.brainDecision?.chosenNodeId === 'BuildDwelling'
      ) {
        buildDwellingChosen = true;
        break;
      }
    }

    expect(adult.moods?.unhoused ?? 0).toBeGreaterThan(0);
    expect(buildDwellingChosen).toBe(true);
  });
});
