import { describe, expect, it } from 'vitest';
import { createSimulationState, stepSimulationState, type SimulationState } from '../src/sim/sim.worker.ts';

type FearDwellTotals = {
  baby: number;
  child: number;
};

function measureFearDwells(ticks: number): FearDwellTotals {
  const state: SimulationState = createSimulationState({
    worldSize: [64, 64],
    agentCount: 12,
    seed: 'regression-seed',
  });

  let baby = 0;
  let child = 0;

  for (let i = 0; i < ticks; i += 1) {
    for (const agent of state.agents) {
      if (agent.lifeStage === 'baby' && agent.brain.currentNodeId === 'FearScream') {
        baby += 1;
      } else if (agent.lifeStage === 'child' && agent.brain.currentNodeId === 'HideWhenScared') {
        child += 1;
      }
    }
    stepSimulationState(state);
  }

  return { baby, child };
}

describe('environmental threats and fear responses', () => {
  it('produce sustained fear dwell time for infants and children', () => {
    const totals = measureFearDwells(5000);
    expect(totals.baby).toBeGreaterThan(50);
    expect(totals.child).toBeGreaterThan(50);
  });

  it('remain deterministic across repeated harness runs', () => {
    const first = measureFearDwells(5000);
    const second = measureFearDwells(5000);
    expect(second).toEqual(first);
  });
});
