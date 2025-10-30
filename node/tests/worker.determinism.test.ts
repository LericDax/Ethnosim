import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createSnapshot, createSimulationState, stepSimulationState } from '../src/sim/sim.worker.ts';
import { saveSimulationState } from '../src/sim/io/save.ts';
import { loadSimulationState } from '../src/sim/io/load.ts';

const TEST_STATE_ID = 'worker-determinism';

async function advanceSimulationTicks(ticks: number, state = createSimulationState({ scenarioId: 'baseline_small', seed: 'determinism-seed' })) {
  for (let i = 0; i < ticks; i += 1) {
    stepSimulationState(state);
  }
  return state;
}

describe('worker state persistence determinism', () => {
  it('produces identical snapshots after save/load round-trips', async () => {
    const baseState = await advanceSimulationTicks(200);
    await saveSimulationState(TEST_STATE_ID, baseState);

    const continuedState = await advanceSimulationTicks(100, baseState);
    const continuedSnapshot = createSnapshot(continuedState);

    const restored = await loadSimulationState(TEST_STATE_ID);
    expect(restored).not.toBeNull();
    const restoredState = restored!;
    expect(restoredState.tick).toBe(200);
    expect(restoredState.scenarioId).toBe(baseState.scenarioId);
    expect(restoredState.seed).toBe(baseState.seed);

    for (let i = 0; i < 100; i += 1) {
      stepSimulationState(restoredState);
    }
    const restoredSnapshot = createSnapshot(restoredState);

    expect(restoredSnapshot).toEqual(continuedSnapshot);
  });
});
