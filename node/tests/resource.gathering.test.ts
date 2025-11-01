import { describe, expect, it } from 'vitest';
import { createSimulationState, stepSimulationState } from '../src/sim/sim.worker.ts';
import { isForestTile } from '../src/sim/engine/world.ts';

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
});
