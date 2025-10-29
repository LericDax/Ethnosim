export const MOOD_KEYS = ['contentment', 'fear', 'boredom', 'zeal', 'bitterness', 'rage'];

const BASELINES = {
  contentment: 0.5,
  fear: 0.2,
  boredom: 0.4,
  zeal: 0.3,
  bitterness: 0.2,
  rage: 0.1,
};

const MOOD_TAG_WEIGHTS = {
  contentment: { home: 0.4, rest: 0.3, social: 0.2, outward: -0.3, risk: -0.2 },
  fear: { alert: 0.4, guard: 0.3, fear: 0.4, outward: -0.4, risk: 0.3 },
  boredom: { outward: -0.4, work: -0.2, rest: 0.3, home: 0.2 },
  zeal: { ritual: 0.5, loyalty: 0.3, doctrine: 0.3, build: 0.2, social: 0.1 },
  bitterness: { resentment: 0.5, selfish: 0.4, resource: 0.2, social: -0.3, care: -0.2 },
  rage: { guard: 0.2, retaliation: 0.5, territorial: 0.3, conflict: 0.3, rest: -0.2 },
};

/**
 * Returns a fresh moods object for a newly created agent.
 */
export function createInitialMoods() {
  const moods = {};
  for (const key of MOOD_KEYS) {
    moods[key] = BASELINES[key];
  }
  return moods;
}

/**
 * Gently nudges each mood toward its baseline so moods remain bounded.
 * @param {Record<string, number>} moods
 */
export function decayMoods(moods) {
  for (const key of MOOD_KEYS) {
    const baseline = BASELINES[key];
    moods[key] += (baseline - moods[key]) * 0.05;
  }
}

/**
 * Applies node-driven adjustments to an agent's moods.
 * @param {Record<string, number>} moods
 * @param {{tags?: string[]}} node
 */
export function applyNodeMoodEffects(moods, node) {
  if (!node?.tags) return;
  const tags = node.tags;
  const has = (tag) => tags.includes(tag);

  if (has('home') || has('rest')) {
    moods.contentment = clamp01(moods.contentment + 0.05);
    moods.fear = clamp01(moods.fear - 0.04);
    moods.rage = clamp01(moods.rage - 0.03);
  }
  if (has('social') || has('bonding')) {
    moods.contentment = clamp01(moods.contentment + 0.03);
    moods.bitterness = clamp01(moods.bitterness - 0.04);
  }
  if (has('outward') || has('risk')) {
    moods.boredom = clamp01(moods.boredom - 0.05);
    moods.fear = clamp01(moods.fear + 0.02);
  }
  if (has('ritual') || has('loyalty') || has('doctrine')) {
    moods.zeal = clamp01(moods.zeal + 0.05);
    moods.contentment = clamp01(moods.contentment + 0.01);
  }
  if (has('guard') || has('alert') || has('conflict') || has('retaliation')) {
    moods.fear = clamp01(moods.fear + 0.05);
    moods.rage = clamp01(moods.rage + 0.04);
  }
  if (has('selfish') || has('resentment')) {
    moods.bitterness = clamp01(moods.bitterness + 0.05);
  }
  if (has('care') || has('need') || has('help')) {
    moods.contentment = clamp01(moods.contentment + 0.02);
    moods.zeal = clamp01(moods.zeal + 0.01);
  }
}

/**
 * Computes the multiplier contributed by moods for a target node.
 * @param {Record<string, number>} moods
 * @param {{id:string,tags?:string[]}} node
 */
export function computeMoodMultiplier(moods, node) {
  if (!node?.tags?.length) return 1;
  let multiplier = 1;
  for (const key of MOOD_KEYS) {
    const intensity = clamp01(moods[key]);
    const weights = MOOD_TAG_WEIGHTS[key];
    if (!weights) continue;
    for (const tag of node.tags) {
      const weight = weights[tag];
      if (weight) {
        multiplier *= 1 + (intensity - BASELINES[key]) * weight;
      }
    }
  }
  return Math.max(0.1, multiplier);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
