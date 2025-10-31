import { describe, expect, it } from 'vitest';
import { createSimulationState, createSnapshot, stepSimulationState } from '../src/sim/sim.worker.ts';

function assertSnapshotMatchesSharedContract(snapshot: ReturnType<typeof createSnapshot>) {
  expect(snapshot.type).toBe('SNAPSHOT');
  expect(snapshot.version).toBeGreaterThan(0);
  expect(typeof snapshot.scenarioId).toBe('string');
  expect(typeof snapshot.seed).toBe('number');
  expect(typeof snapshot.seedHex).toBe('string');
  expect(snapshot.seedHex.startsWith('0x')).toBe(true);
  expect(typeof snapshot.tick).toBe('number');
  expect(snapshot.world).toBeTruthy();
  expect(typeof snapshot.world.width).toBe('number');
  expect(typeof snapshot.world.height).toBe('number');
  expect(typeof snapshot.world.w).toBe('number');
  expect(typeof snapshot.world.h).toBe('number');
  expect(Array.isArray(snapshot.agents)).toBe(true);
  expect(Array.isArray(snapshot.houses)).toBe(true);
  expect(Array.isArray(snapshot.demands)).toBe(true);
  expect(Array.isArray(snapshot.decisions)).toBe(true);

  for (const agent of snapshot.agents) {
    expect(typeof agent.id).toBe('string');
    expect(typeof agent.x).toBe('number');
    expect(typeof agent.y).toBe('number');
    expect(typeof agent.lifeStage).toBe('string');
    expect(agent.ageStage).toBe(agent.lifeStage);
    expect(typeof agent.brainNode).toBe('string');
    expect(agent.brain).toBeTruthy();
    expect(agent.brain.summary.brainId).toBeTruthy();
    expect(typeof agent.brain.summary.nodeId).toBe('string');
    expect(typeof agent.brain.summary.nodeTimer).toBe('number');
    expect(typeof agent.brain.summary.nodeDuration).toBe('number');
    expect(Array.isArray(agent.brain.summary.traitFlags)).toBe(true);
    expect(Array.isArray(agent.brain.summary.tags)).toBe(true);
    expect(agent.brain.state.brainId).toBe(agent.brain.summary.brainId);
    expect(agent.brain.state.currentNodeId).toBe(agent.brain.summary.nodeId);
    expect(typeof agent.brain.state.plasticity.tick).toBe('number');
    expect(typeof agent.brain.state.plasticity.edges).toBe('object');
    expect(typeof agent.pregnant).toBe('boolean');
    expect(agent.temperament).toBeTruthy();
    expect(typeof agent.temperament.trustBias).toBe('number');
    expect(typeof agent.houseId === 'string' || agent.houseId === null).toBe(true);
  }

  for (const house of snapshot.houses) {
    expect(typeof house.id).toBe('string');
    expect(typeof house.x).toBe('number');
    expect(typeof house.y).toBe('number');
    expect(typeof house.radius).toBe('number');
    expect(Array.isArray(house.members)).toBe(true);
    expect(typeof house.authority).toBe('number');
    expect(house.brain.summary.brainId).toBeTruthy();
  }

  if (snapshot.city) {
    expect(typeof snapshot.city.id).toBe('string');
    expect(typeof snapshot.city.authority).toBe('number');
    expect(snapshot.city.brain.summary.brainId).toBeTruthy();
    expect(typeof snapshot.city.demandExpiresAt).toBe('number');
  }

  for (const decision of snapshot.decisions) {
    expect(typeof decision.agent_id).toBe('string');
    expect(typeof decision.from).toBe('string');
    expect(typeof decision.to).toBe('string');
  }
}

describe('snapshot schema compatibility', () => {
  it('matches the shared snapshot contract', () => {
    const state = createSimulationState({ scenarioId: 'baseline_small', seed: 'schema-seed' });
    for (let i = 0; i < 50; i += 1) {
      stepSimulationState(state);
    }
    const snapshot = createSnapshot(state);
    assertSnapshotMatchesSharedContract(snapshot);
  });
});
