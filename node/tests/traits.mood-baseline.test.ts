import { describe, expect, it } from 'vitest';
import { createTraitProfile } from '../src/sim/engine/traits.ts';
import { buildBrainMultipliers, buildInitialMoodState } from '../src/sim/sim.worker.ts';
import type { Temperament } from '../src/sim/sim.worker.ts';

describe('trait-driven mood baselines', () => {
  const territorialTemperament: Temperament = {
    trustBias: 0.4,
    fearBias: 0.35,
    loyaltyBias: 0.55,
    resentmentBias: 0.82,
    territorialBias: 0.86,
    zealBias: 0.3,
  };

  it('keeps moodLevels neutral while retaining multipliers on the profile', () => {
    const profile = createTraitProfile(territorialTemperament);

    expect(profile.traitFlags).toContain('territorial');
    expect(profile.traitFlags).toContain('resentful');
    expect(profile.multipliers.mood?.guard).toBeCloseTo(1.2);
    expect(profile.multipliers.mood?.outward).toBeCloseTo(1.1 * 1.18);
    expect(profile.moodLevels.guard).toBe(0);
    expect(profile.moodLevels.outward).toBe(0);
  });

  it('initializes guard/outward moods at neutral values in calm conditions', () => {
    const profile = createTraitProfile(territorialTemperament);
    const brainMultipliers = buildBrainMultipliers(profile);
    const moods = buildInitialMoodState(profile, brainMultipliers);

    expect(moods.guard).toBe(0);
    expect(moods.outward).toBe(0);
    expect(moods.unhoused).toBe(0);

    const guardBase = brainMultipliers.mood?.guard ?? 1;
    const outwardBase = brainMultipliers.mood?.outward ?? 1;
    const guardEffective = guardBase * (1 + (moods.guard ?? 0));
    const outwardEffective = outwardBase * (1 + (moods.outward ?? 0));

    expect(guardEffective).toBeCloseTo(guardBase);
    expect(outwardEffective).toBeCloseTo(outwardBase);
  });
});
