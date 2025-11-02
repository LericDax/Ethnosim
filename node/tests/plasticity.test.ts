import { describe, expect, it } from 'vitest';
import {
  advancePlasticityState,
  createPlasticityState,
  registerPlasticityOutcome,
} from '../src/sim/engine/plasticity.ts';

function getEdge(state, sourceId, targetId) {
  return state.edges.get(sourceId)?.get(targetId) ?? null;
}

describe('plasticity outcomes', () => {
  it('applies potentiation rewards with symmetric clamping', () => {
    const state = createPlasticityState();
    registerPlasticityOutcome(state, 'A', 'B', 1);
    const edge = getEdge(state, 'A', 'B');
    expect(edge).toBeTruthy();
    expect(edge?.adjustment ?? 0).toBeGreaterThan(0);

    for (let i = 0; i < 64; i += 1) {
      registerPlasticityOutcome(state, 'A', 'B', 1);
    }
    const reinforced = getEdge(state, 'A', 'B');
    expect(reinforced).toBeTruthy();
    expect(reinforced?.adjustment ?? 0).toBeLessThanOrEqual(1);
  });

  it('applies depression rewards and keeps adjustment within bounds', () => {
    const state = createPlasticityState();
    registerPlasticityOutcome(state, 'X', 'Y', -1);
    let edge = getEdge(state, 'X', 'Y');
    expect(edge).toBeTruthy();
    expect(edge?.adjustment ?? 0).toBeLessThan(0);

    for (let i = 0; i < 64; i += 1) {
      registerPlasticityOutcome(state, 'X', 'Y', -1);
    }
    edge = getEdge(state, 'X', 'Y');
    expect(edge).toBeTruthy();
    expect(edge?.adjustment ?? 0).toBeGreaterThanOrEqual(-1);
  });

  it('decays adjustments back toward zero over time', () => {
    const state = createPlasticityState();
    registerPlasticityOutcome(state, 'N', 'O', 1);
    let edge = getEdge(state, 'N', 'O');
    expect(edge).toBeTruthy();
    const initial = edge?.adjustment ?? 0;
    expect(initial).toBeGreaterThan(0);

    for (let i = 0; i < 80; i += 1) {
      advancePlasticityState(state);
    }
    edge = getEdge(state, 'N', 'O');
    expect(edge).toBeNull();
  });

  it('ignores negligible rewards below the persistence threshold', () => {
    const state = createPlasticityState();
    registerPlasticityOutcome(state, 'S', 'T', 0.01);
    const edge = getEdge(state, 'S', 'T');
    expect(edge).toBeNull();
  });
});
