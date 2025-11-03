import { describe, expect, it } from 'vitest';
import { createSimulationState, stepSimulationState } from '../src/sim/sim.worker.ts';
import { updateCollectiveDemands } from '../src/sim/engine/collectives.ts';

function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  expect(value, message).toBeDefined();
}

describe('collective demand directives', () => {
  it('retains housing directives long enough to trigger dwell building', () => {
    const simulation = createSimulationState({
      agentCount: 8,
      worldSize: [28, 28],
      seed: 'housing-demand-directives',
    });

    const house = simulation.houses[0];
    assertDefined(house, 'expected a house to be present in the simulation');

    const adult = simulation.agents.find((agent) => agent.lifeStage === 'adult');
    assertDefined(adult, 'expected at least one adult agent');

    const supportingMembers = simulation.agents
      .filter((agent) => agent.id !== adult.id)
      .slice(0, 3);

    house.members = [adult.id];
    adult.houseId = house.id;
    adult.brain.currentNodeId = 'Rest';
    adult.brain.nodeTimer = 0;
    adult.brainDecision = null;

    for (const member of supportingMembers) {
      member.houseId = house.id;
      house.members.push(member.id);
    }

    house.maxMembers = 2;
    house.preferredMembers = 2;
    house.capacityPressure = Math.max(0, house.members.length - 2);
    house.construction.active = false;
    house.construction.progress = 0;
    house.activeDemand = {};
    house.leaderDirectives = { build: 1.05, home: 1.05 };

    simulation.pendingHouseAssignments = ['wait-0', 'wait-1', 'wait-2', 'wait-3'];

    updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick, {
      rng: simulation.rng.collectives,
      pendingAssignmentCount: simulation.pendingHouseAssignments.length,
    });

    const observationWindow = 36;
    const buildTicks: number[] = [];
    const buildDirectiveTrace: number[] = [];
    const initialTick = simulation.tick;

    for (let i = 0; i < observationWindow; i += 1) {
      stepSimulationState(simulation);
      buildDirectiveTrace.push(adult.brainMultipliers.demand?.build ?? 1);
      if (
        adult.brain.currentNodeId === 'BuildDwelling' ||
        adult.brainDecision?.chosenNodeId === 'BuildDwelling'
      ) {
        buildTicks.push(simulation.tick);
      }
    }

    expect(buildTicks.length).toBeGreaterThan(0);
    const firstBuildTick = buildTicks[0];
    expect(firstBuildTick).toBeLessThanOrEqual(initialTick + 24);
    expect(house.construction.active).toBe(true);
    const peakDirective = Math.max(...buildDirectiveTrace);
    expect(peakDirective).toBeGreaterThan(1.05);
  });
});
