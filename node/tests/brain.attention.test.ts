import { describe, expect, it } from 'vitest';
import {
  createBrainState,
  refreshBrainContext,
  previewBrainCandidates,
  tickBrain,
} from '../src/sim/engine/brain.ts';
import { createSeededRng } from '../src/sim/engine/rng.ts';

describe('brain attention embedding', () => {
  it('prioritizes nodes aligned with the active context embedding', () => {
    const fearState = createBrainState('ChildMind_v1');
    fearState.currentNodeId = 'ExploreNearby';
    fearState.nodeTimer = 0;

    refreshBrainContext(fearState, { mood: { fear: 1.6, safety: 1.4 } });
    const fearCandidates = previewBrainCandidates(fearState);

    expect(fearCandidates[0]?.nodeId).toBe('HideWhenScared');
    expect(fearCandidates[0]?.attentionScore ?? 0).toBeGreaterThan(
      fearCandidates[1]?.attentionScore ?? 0,
    );

    const ritualState = createBrainState('ChildMind_v1');
    ritualState.currentNodeId = 'ExploreNearby';
    ritualState.nodeTimer = 0;
    refreshBrainContext(ritualState, {
      mood: { ritual: 2, loyalty: 1.9 },
      personality: { doctrine: 1.6 },
      demand: { ritual: 1.8, doctrine: 2.1 },
    });
    const ritualCandidates = previewBrainCandidates(ritualState);

    const ritualFocus = ritualCandidates.find((candidate) => candidate.nodeId === 'ImitateRitual');
    const fearFocus = ritualCandidates.find((candidate) => candidate.nodeId === 'HideWhenScared');
    expect(ritualFocus).toBeTruthy();
    expect(fearFocus).toBeTruthy();
    expect((ritualFocus?.attentionScore ?? 0) > (fearFocus?.attentionScore ?? 0)).toBe(true);
  });

  it('remains deterministic under a seeded RNG stream', () => {
    const baseA = createBrainState('ChildMind_v1');
    baseA.currentNodeId = 'ExploreNearby';
    baseA.nodeTimer = 0;
    const baseB = createBrainState('ChildMind_v1');
    baseB.currentNodeId = 'ExploreNearby';
    baseB.nodeTimer = 0;

    const readyTargets = ['HideWhenScared', 'ImitateRitual', 'FollowCaregiver'];
    for (const targetId of readyTargets) {
      baseA.nodeCharge.set(targetId, { value: 10, capacity: 1 });
      baseB.nodeCharge.set(targetId, { value: 10, capacity: 1 });
    }

    const seed = 'attention-determinism';
    const rngA = createSeededRng(seed).stream('attention');
    const rngB = createSeededRng(seed).stream('attention');

    const resultA = tickBrain(baseA, { mood: { fear: 1.5 } }, {}, { tick: 1, rng: rngA });
    const resultB = tickBrain(baseB, { mood: { fear: 1.5 } }, {}, { tick: 1, rng: rngB });

    const candidatesA = resultA.decision?.candidates ?? baseA.lastDecision?.candidates ?? [];
    const candidatesB = resultB.decision?.candidates ?? baseB.lastDecision?.candidates ?? [];

    expect(candidatesA.map((candidate) => candidate.nodeId)).toEqual(
      candidatesB.map((candidate) => candidate.nodeId),
    );
    expect(
      candidatesA.map((candidate) => Number(candidate.attentionScore).toFixed(3)),
    ).toEqual(candidatesB.map((candidate) => Number(candidate.attentionScore).toFixed(3)));
  });
});
