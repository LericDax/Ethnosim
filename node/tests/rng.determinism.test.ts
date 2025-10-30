import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createSimulationState,
  stepSimulationState,
  createSnapshot,
  type SimulationState,
} from '../src/sim/sim.worker.ts';

function runSimulation(seed: number | string, ticks: number): string {
  const state: SimulationState = createSimulationState({
    worldSize: [64, 64],
    agentCount: 12,
    seed,
  });

  for (let i = 0; i < ticks; i += 1) {
    stepSimulationState(state);
  }

  const snapshot = createSnapshot(state);
  const serialized = JSON.stringify(snapshot);
  return createHash('sha256').update(serialized).digest('hex');
}

describe('seeded simulation determinism', () => {
  it('produces identical snapshots for repeated runs with the same seed', () => {
    const first = runSimulation('regression-seed', 5000);
    const second = runSimulation('regression-seed', 5000);
    expect(second).toBe(first);
  });
});
