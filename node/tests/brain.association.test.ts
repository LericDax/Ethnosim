import { describe, expect, it } from 'vitest';
import { createBrainState, tickBrain } from '../src/sim/engine/brain.ts';

function getDynamicEdge(state, sourceId, targetId) {
  const edges = state.dynamicEdgesFrom.get(sourceId) ?? [];
  return edges.find((edge) => edge.targetId === targetId) ?? null;
}

describe('recent association edges', () => {
  it('creates trace edges from recent charge residues', () => {
    const state = createBrainState('BabyMind_v1');
    state.currentNodeId = 'CryForCare';
    state.nodeTimer = 0;
    state.nodeCharge.set('Feed', { value: 1, capacity: 1 });
    state.nodeCharge.set('ObserveVoices', { value: 0.6, capacity: 1 });

    tickBrain(state);

    expect(state.currentNodeId).toBe('Feed');
    const key = 'Feed->ObserveVoices';
    const association = state.recentAssociations.get(key);
    expect(association).toBeTruthy();
    expect(association?.weight ?? 0).toBeGreaterThan(0);

    const dynamicEdge = getDynamicEdge(state, 'Feed', 'ObserveVoices');
    expect(dynamicEdge).toBeTruthy();
    expect(dynamicEdge?.weight ?? 0).toBeCloseTo(association?.weight ?? 0, 3);
    expect(association?.ttl ?? 0).toBeGreaterThan(0);
  });

  it('decays association weights and removes expired traces', () => {
    const state = createBrainState('BabyMind_v1');
    state.currentNodeId = 'CryForCare';
    state.nodeTimer = 0;
    state.nodeCharge.set('Feed', { value: 1, capacity: 1 });
    state.nodeCharge.set('ObserveVoices', { value: 0.75, capacity: 1 });

    tickBrain(state);

    const key = 'Feed->ObserveVoices';
    let association = state.recentAssociations.get(key);
    expect(association).toBeTruthy();
    const initialWeight = association?.weight ?? 0;
    const initialTtl = association?.ttl ?? 0;
    expect(initialWeight).toBeGreaterThan(0);
    expect(initialTtl).toBeGreaterThan(0);

    tickBrain(state);
    association = state.recentAssociations.get(key);
    expect(association).toBeTruthy();
    expect(association?.weight ?? 0).toBeLessThan(initialWeight);
    expect(association?.ttl ?? 0).toBe(initialTtl - 1);

    for (let i = 0; i < initialTtl + 1; i += 1) {
      tickBrain(state);
    }

    expect(state.recentAssociations.has(key)).toBe(false);
    const dynamicEdge = getDynamicEdge(state, 'Feed', 'ObserveVoices');
    expect(dynamicEdge).toBeFalsy();
  });
});
