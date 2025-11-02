import { describe, expect, it } from 'vitest';
import { createSimulationState, stepSimulationState } from '../src/sim/sim.worker.ts';
import { isForestTile } from '../src/sim/engine/world.ts';
import { updateCollectiveDemands } from '../src/sim/engine/collectives.ts';
import { createInitialMovementState, moveAgent } from '../src/sim/engine/move.ts';

function findForestTile(simulation: ReturnType<typeof createSimulationState>): { x: number; y: number } {
  for (let y = simulation.world.height - 1; y >= 0; y -= 1) {
    for (let x = simulation.world.width - 1; x >= 0; x -= 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      if (isForestTile(simulation.world, sampleX, sampleY)) {
        return { x: sampleX, y: sampleY };
      }
    }
  }
  throw new Error('No forest tile found in generated world');
}

describe('resource gathering', () => {
  it('harvests wood when adults gather in forests', () => {
    const simulation = createSimulationState({ agentCount: 4, worldSize: [24, 24], seed: 'gather-regression' });
    const agent = simulation.agents.find((entry) => entry.lifeStage === 'adult');
    expect(agent).toBeDefined();
    if (!agent) {
      return;
    }

    simulation.agents = [agent];
    simulation.houses = [];
    simulation.leadership.houses = {};
    simulation.city = null;
    simulation.stageCounts = { baby: 0, child: 0, teen: 0, adult: 1 };

    const forestPosition = findForestTile(simulation);
    agent.x = forestPosition.x;
    agent.y = forestPosition.y;
    agent.speed = 0;
    agent.houseId = null;
    agent.brain.currentNodeId = 'Gather';
    agent.brain.nodeTimer = 4;
    agent.brainNodeDuration = 4;
    agent.carriedResources.wood = 0;
    agent.resourceActivity = null;

    const initialWood = agent.carriedResources.wood;
    stepSimulationState(simulation);

    expect(agent.carriedResources.wood).toBeGreaterThan(initialWood);
  });

  it('prioritizes resource harvesting for wood when the household lacks it', () => {
    const simulation = createSimulationState({ agentCount: 6, worldSize: [24, 24], seed: 'housing-wood-demand' });
    const adult = simulation.agents.find((entry) => entry.lifeStage === 'adult');
    expect(adult).toBeDefined();
    if (!adult) {
      return;
    }

    const additionalMember = simulation.agents.find((entry) => entry.id !== adult.id);
    expect(additionalMember).toBeDefined();
    if (!additionalMember) {
      return;
    }
    const house = simulation.houses[0];
    house.members = [adult.id, additionalMember.id];
    house.maxMembers = 1;
    house.preferredMembers = 1;
    house.capacityPressure = house.members.length - 1;
    house.construction.active = false;
    house.construction.progress = 0;
    house.construction.required = Math.max(1, house.construction.required);
    house.activeDemand = {};
    house.leaderDirectives = {};

    adult.houseId = house.id;
    additionalMember.houseId = house.id;
    adult.movement = createInitialMovementState();
    adult.brain.currentNodeId = 'Rest';
    adult.brain.nodeTimer = 4;

    simulation.pendingHouseAssignments = ['wait-1', 'wait-2'];
    updateCollectiveDemands(simulation.houses, simulation.city, simulation.agents, simulation.tick, {
      rng: simulation.rng.collectives,
      pendingAssignmentCount: simulation.pendingHouseAssignments.length,
    });

    expect(house.activeDemand.wood ?? 0).toBeGreaterThan(0);

    const agentsById = new Map(simulation.agents.map((entry) => [entry.id, entry]));
    const housesById = new Map([[house.id, house]]);
    moveAgent(
      adult,
      {
        world: simulation.world,
        agentsById,
        housesById,
        city: simulation.city,
        tick: simulation.tick,
      },
      simulation.rng.tick,
    );

    expect(adult.movement.behaviorId).toBe('resource-harvest');
    expect(adult.movement.data).toBeDefined();
    if (adult.movement.data) {
      expect(adult.movement.data.resourceType).toBe('wood');
    }
  });
});
