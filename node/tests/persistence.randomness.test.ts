import { describe, expect, it } from 'vitest';
import { createSimulationState, type SimulationConfig } from '../src/sim/sim.worker.ts';
import { serializeSimulationState } from '../src/sim/io/save.ts';
import { restoreSimulationState } from '../src/sim/io/load.ts';

function config(overrides: Partial<SimulationConfig>): SimulationConfig {
  return {
    worldSize: [24, 24],
    agentCount: 4,
    seed: 'persist-seed',
    scenarioId: 'baseline_small',
    randomnessMode: 'deterministic',
    ...overrides,
  };
}

describe('simulation persistence', () => {
  it('restores deterministic saves byte-for-byte', () => {
    const state = createSimulationState(config({ randomnessMode: 'deterministic', seed: 'persist-deterministic' }));
    const serialized = serializeSimulationState(state);
    const restored = restoreSimulationState(serialized);
    const reserialized = serializeSimulationState(restored);

    expect(restored.randomnessMode).toBe('deterministic');
    expect(restored.randomnessMeta.runId).toBe(serialized.randomness?.runId);
    expect(reserialized).toEqual(serialized);
  });

  it('restores chaotic saves with fresh rng suites and preserved metadata', () => {
    const state = createSimulationState(config({ randomnessMode: 'chaotic', seed: 'persist-chaotic' }));
    const serialized = serializeSimulationState(state);

    expect(serialized.randomnessMode).toBe('chaotic');
    expect(serialized.randomness?.mode).toBe('chaotic');
    expect(serialized.rng).toBeNull();

    const restored = restoreSimulationState(serialized);

    expect(restored.randomnessMode).toBe('chaotic');
    expect(restored.randomnessMeta.runId).toBe(serialized.randomness?.runId);
    expect(restored.randomnessMeta.rootSeed).toBeNull();
    expect(restored.rng.root.serialize().seed).toBe('chaotic');

    const reserialized = serializeSimulationState(restored);
    expect(reserialized.randomness?.runId).toBe(serialized.randomness?.runId);
    expect(reserialized.rng).toBeNull();
    expect(reserialized.randomnessMode).toBe('chaotic');
  });
});
