import type { Temperament } from '../../sim.worker.ts';

export interface TraitDefinition {
  id: string;
  temperamentKey: keyof Temperament;
  threshold: number;
  multipliers: TraitMultiplierSet;
}

export interface TraitMultiplierSet {
  mood?: Record<string, number>;
  personality?: Record<string, number>;
}

export interface TraitProfile {
  traitFlags: string[];
  multipliers: TraitMultiplierSet;
  moodLevels: Record<string, number>;
}

export interface JumpEdgeDefinition {
  id: string;
  sourceNodes?: string[];
  sourceTags?: string[];
  targetNodeId: string;
  moodTrigger: string;
  activationThreshold: number;
  releaseThreshold: number;
  cooldownTicks: number;
  weight: number;
  activationChance: number;
  requiredTraits?: string[];
}

const TRAIT_DEFINITIONS: TraitDefinition[] = [
  {
    id: 'steadfast',
    temperamentKey: 'loyaltyBias',
    threshold: 0.75,
    multipliers: {
      mood: {
        home: 1.12,
        social: 1.05,
      },
      personality: {
        home: 1.1,
        duty: 1.1,
      },
    },
  },
  {
    id: 'territorial',
    temperamentKey: 'territorialBias',
    threshold: 0.7,
    multipliers: {
      mood: {
        guard: 1.2,
        outward: 1.1,
      },
      personality: {
        guard: 1.1,
      },
    },
  },
  {
    id: 'resentful',
    temperamentKey: 'resentmentBias',
    threshold: 0.7,
    multipliers: {
      mood: {
        outward: 1.18,
      },
      personality: {
        outward: 1.08,
      },
    },
  },
  {
    id: 'visionary',
    temperamentKey: 'zealBias',
    threshold: 0.7,
    multipliers: {
      mood: {
        build: 1.1,
      },
      personality: {
        build: 1.12,
        outward: 1.05,
      },
    },
  },
];

export const JUMP_EDGE_DEFINITIONS: JumpEdgeDefinition[] = [
  {
    id: 'territorial-alarm',
    sourceTags: ['home', 'rest'],
    targetNodeId: 'Patrol',
    moodTrigger: 'guard',
    activationThreshold: 1.15,
    releaseThreshold: 1.05,
    cooldownTicks: 24,
    weight: 1.2,
    activationChance: 0.9,
    requiredTraits: ['territorial'],
  },
  {
    id: 'territorial-strike',
    sourceTags: ['home'],
    targetNodeId: 'MarkTerritory',
    moodTrigger: 'outward',
    activationThreshold: 1.18,
    releaseThreshold: 1.05,
    cooldownTicks: 30,
    weight: 1.25,
    activationChance: 0.85,
    requiredTraits: ['resentful', 'territorial'],
  },
  {
    id: 'steadfast-duty',
    sourceTags: ['outward'],
    targetNodeId: 'BuildDwelling',
    moodTrigger: 'home',
    activationThreshold: 1.1,
    releaseThreshold: 1.02,
    cooldownTicks: 18,
    weight: 1.15,
    activationChance: 0.75,
    requiredTraits: ['steadfast'],
  },
  {
    id: 'housing-urgency',
    sourceNodes: ['Rest', 'Stockpile'],
    targetNodeId: 'BuildDwelling',
    moodTrigger: 'unhoused',
    activationThreshold: 0.6,
    releaseThreshold: 0.2,
    cooldownTicks: 12,
    weight: 1.2,
    activationChance: 0.9,
  },
];

export function createTraitProfile(temperament: Temperament): TraitProfile {
  const traitFlags: string[] = [];
  const moodMultipliers: Record<string, number> = {};
  const personalityMultipliers: Record<string, number> = {};

  for (const definition of TRAIT_DEFINITIONS) {
    const value = temperament[definition.temperamentKey];
    if (typeof value !== 'number' || value < definition.threshold) {
      continue;
    }

    traitFlags.push(definition.id);
    if (definition.multipliers.mood) {
      mergeMultiplierMap(moodMultipliers, definition.multipliers.mood);
    }
    if (definition.multipliers.personality) {
      mergeMultiplierMap(personalityMultipliers, definition.multipliers.personality);
    }
  }

  const multipliers: TraitMultiplierSet = {};
  if (Object.keys(moodMultipliers).length > 0) {
    multipliers.mood = moodMultipliers;
  }
  if (Object.keys(personalityMultipliers).length > 0) {
    multipliers.personality = personalityMultipliers;
  }

  return {
    traitFlags,
    multipliers,
    moodLevels: { ...moodMultipliers },
  };
}

function mergeMultiplierMap(target: Record<string, number>, additions: Record<string, number>): void {
  for (const [key, value] of Object.entries(additions)) {
    if (!Number.isFinite(value)) {
      continue;
    }
    const existing = target[key] ?? 1;
    target[key] = existing * value;
  }
}
