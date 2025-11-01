import { describe, expect, it } from 'vitest';
import { createSimulationState, type SimulationConfig } from '../src/sim/sim.worker.ts';

describe('randomness modes', () => {
  function createConfig(overrides: Partial<SimulationConfig>): SimulationConfig {
    return {
      worldSize: [24, 24],
      agentCount: 6,
      seed: 'shared-seed',
      scenarioId: null,
      randomnessMode: 'deterministic',
      ...overrides,
    };
  }

  it('deterministic mode produces reproducible states for identical seeds', () => {
    const config = createConfig({ randomnessMode: 'deterministic' });
    const stateA = createSimulationState(config);
    const stateB = createSimulationState(config);

    expect(stateA.randomnessMode).toBe('deterministic');
    expect(stateB.randomnessMode).toBe('deterministic');
    expect(stateA.seed).toBe(stateB.seed);
    expect(stateA.world.terrain.tiles).toEqual(stateB.world.terrain.tiles);

    const agentPositionsA = stateA.agents.map((agent) => [agent.x, agent.y]);
    const agentPositionsB = stateB.agents.map((agent) => [agent.x, agent.y]);
    expect(agentPositionsA).toEqual(agentPositionsB);

    const nextTickA = stateA.rng.tick.nextFloat();
    const nextTickB = stateB.rng.tick.nextFloat();
    expect(nextTickA).toBe(nextTickB);
  });

  it('chaotic mode diverges even when the seed is held constant', () => {
    const config = createConfig({ randomnessMode: 'chaotic' });
    const stateA = createSimulationState(config);
    const stateB = createSimulationState(config);

    expect(stateA.randomnessMode).toBe('chaotic');
    expect(stateB.randomnessMode).toBe('chaotic');
    expect(stateA.seed).toBe('chaotic');
    expect(stateB.seed).toBe('chaotic');

    const forestMatches = stateA.world.forestResources.every(
      (value, index) => value === stateB.world.forestResources[index],
    );
    expect(forestMatches).toBe(false);

    const nextTickA = stateA.rng.tick.nextFloat();
    const nextTickB = stateB.rng.tick.nextFloat();
    expect(nextTickA).not.toBe(nextTickB);
  });
});
