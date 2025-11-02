import { describe, expect, it } from 'vitest';
import { createSimulationState, stepSimulationState } from '../src/sim/sim.worker.ts';

function getBaby(simulation: ReturnType<typeof createSimulationState>) {
  const baby = simulation.agents.find((agent) => agent.lifeStage === 'baby');
  if (!baby) {
    throw new Error('Expected simulation to include a baby agent');
  }
  return baby;
}

describe('infant attachment stress', () => {
  it('enables FearScream when babies are separated from caregivers', () => {
    const simulation = createSimulationState({
      agentCount: 4,
      worldSize: [48, 48],
      seed: 'infant-attachment-stress',
    });

    const baby = getBaby(simulation);
    const caregiverIds = new Set<string>();
    if (baby.caregiverId) {
      caregiverIds.add(baby.caregiverId);
    }
    for (const parentId of baby.parents ?? []) {
      if (parentId) {
        caregiverIds.add(parentId);
      }
    }

    expect(caregiverIds.size).toBeGreaterThan(0);

    const caregiverList = Array.from(caregiverIds);
    baby.parents = caregiverList;
    baby.x = 2;
    baby.y = 2;

    simulation.agents.forEach((agent, index) => {
      if (agent.id === baby.id) {
        return;
      }
      const offset = 24 + index * 6;
      agent.x = offset;
      agent.y = offset;
    });

    let fearActivated = false;
    for (let i = 0; i < 12; i += 1) {
      stepSimulationState(simulation);
      const fearLevel = baby.moods?.fear ?? 0;
      if (fearLevel >= 1.1 && baby.brain.activeJumpEdges.has('infant-fear-scream')) {
        fearActivated = true;
        break;
      }
    }

    expect(fearActivated).toBe(true);
  });
});
