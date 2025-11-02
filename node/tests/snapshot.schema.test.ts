import { describe, expect, it } from 'vitest';
import { createSimulationState, createSnapshot, stepSimulationState } from '../src/sim/sim.worker.ts';

function assertSnapshotMatchesSharedContract(snapshot: ReturnType<typeof createSnapshot>) {
  expect(snapshot.type).toBe('SNAPSHOT');
  expect(snapshot.version).toBeGreaterThan(0);
  expect(typeof snapshot.scenarioId).toBe('string');
  expect(typeof snapshot.seed).toBe('number');
  expect(typeof snapshot.seedHex).toBe('string');
  if (snapshot.randomnessMode === 'deterministic') {
    expect(snapshot.seedHex.startsWith('0x')).toBe(true);
  } else {
    expect(snapshot.seedHex).toBe('chaotic');
  }
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
    expect(agent.brain.summary.transition).toBeTruthy();
    expect(typeof agent.brain.summary.transition.durationTicks).toBe('number');
    expect(typeof agent.brain.summary.transition.remainingTicks).toBe('number');
    expect(typeof agent.brain.summary.transition.elapsedTicks).toBe('number');
    expect(typeof agent.brain.summary.transition.tickDurationMs).toBe('number');
    expect(Array.isArray(agent.brain.summary.contextEmbedding)).toBe(true);
    expect(Array.isArray(agent.brain.summary.nodeEmbedding)).toBe(true);
    expect(Array.isArray(agent.brain.summary.traitFlags)).toBe(true);
    expect(Array.isArray(agent.brain.summary.tags)).toBe(true);
    expect(agent.brain.state.brainId).toBe(agent.brain.summary.brainId);
    expect(agent.brain.state.currentNodeId).toBe(agent.brain.summary.nodeId);
    expect(typeof agent.brain.state.plasticity.tick).toBe('number');
    expect(typeof agent.brain.state.plasticity.edges).toBe('object');
    expect(Array.isArray(agent.brain.state.contextEmbedding)).toBe(true);
    expect(Array.isArray(agent.brain.state.pendingContextEmbedding)).toBe(true);
    expect(agent.brain.plasticity).toBeTruthy();
    expect(typeof agent.brain.plasticity.tick).toBe('number');
    expect(Array.isArray(agent.brain.plasticity.edges)).toBe(true);
    expect(Array.isArray(agent.brain.contextEmbedding)).toBe(true);
    expect(Array.isArray(agent.brain.nodeEmbedding)).toBe(true);
    for (const edge of agent.brain.plasticity.edges) {
      expect(typeof edge.from).toBe('string');
      expect(typeof edge.to).toBe('string');
      expect(typeof edge.adjustment).toBe('number');
      expect(typeof edge.usageCount).toBe('number');
    }
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
    expect(house.brain.summary.transition).toBeTruthy();
    expect(Array.isArray(house.brain.summary.contextEmbedding)).toBe(true);
    expect(Array.isArray(house.brain.summary.nodeEmbedding)).toBe(true);
    expect(Array.isArray(house.brain.contextEmbedding)).toBe(true);
    expect(Array.isArray(house.brain.nodeEmbedding)).toBe(true);
    expect(Array.isArray(house.brain.state.contextEmbedding)).toBe(true);
    expect(Array.isArray(house.brain.state.pendingContextEmbedding)).toBe(true);
    expect(house.brain.plasticity).toBeTruthy();
    expect(typeof house.brain.plasticity.tick).toBe('number');
    expect(Array.isArray(house.brain.plasticity.edges)).toBe(true);
  }

  if (snapshot.city) {
    expect(typeof snapshot.city.id).toBe('string');
    expect(typeof snapshot.city.authority).toBe('number');
    expect(snapshot.city.brain.summary.brainId).toBeTruthy();
    expect(typeof snapshot.city.demandExpiresAt).toBe('number');
    expect(snapshot.city.brain.summary.transition).toBeTruthy();
    expect(Array.isArray(snapshot.city.brain.summary.contextEmbedding)).toBe(true);
    expect(Array.isArray(snapshot.city.brain.summary.nodeEmbedding)).toBe(true);
    expect(Array.isArray(snapshot.city.brain.contextEmbedding)).toBe(true);
    expect(Array.isArray(snapshot.city.brain.nodeEmbedding)).toBe(true);
    expect(Array.isArray(snapshot.city.brain.state.contextEmbedding)).toBe(true);
    expect(Array.isArray(snapshot.city.brain.state.pendingContextEmbedding)).toBe(true);
    expect(snapshot.city.brain.plasticity).toBeTruthy();
    expect(typeof snapshot.city.brain.plasticity.tick).toBe('number');
    expect(Array.isArray(snapshot.city.brain.plasticity.edges)).toBe(true);
  }

  for (const decision of snapshot.decisions) {
    expect(typeof decision.agent_id).toBe('string');
    expect(typeof decision.from).toBe('string');
    expect(typeof decision.to).toBe('string');
  }

  expect(snapshot.randomness).toBeTruthy();
  expect(snapshot.randomness.mode).toBe(snapshot.randomnessMode);
  expect(typeof snapshot.randomness.runId).toBe('string');
  if (snapshot.randomnessMode === 'deterministic') {
    expect(snapshot.randomness.runId.startsWith('det-')).toBe(true);
  } else {
    expect(snapshot.randomness.runId.startsWith('cha-')).toBe(true);
  }
  expect(snapshot.randomness.seedHex).toBe(snapshot.seedHex);
  expect(typeof snapshot.randomness.seed).toBe('string');
  if (snapshot.randomnessMode === 'deterministic') {
    expect(snapshot.randomness.rootSeed).toBeTypeOf('string');
    expect(snapshot.randomness.rootSeedHex?.startsWith('0x')).toBe(true);
  } else {
    expect(snapshot.randomness.rootSeed).toBeNull();
    expect(snapshot.randomness.rootSeedHex).toBeNull();
  }
}

describe('snapshot schema compatibility', () => {
  it('matches the shared snapshot contract', () => {
    const state = createSimulationState({ scenarioId: 'baseline_small', seed: 'schema-seed' });
    for (let i = 0; i < 50; i += 1) {
      stepSimulationState(state);
    }
    const snapshot = createSnapshot(state);
    expect(snapshot.randomness.seed).toBe(state.seed);
    assertSnapshotMatchesSharedContract(snapshot);
  });
});
