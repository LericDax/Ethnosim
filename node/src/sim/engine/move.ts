import { getCurrentNodeMetadata, type BrainDecision, type BrainState } from './brain.ts';
import type { RngStream } from './rng.ts';
import { clampPosition, type WorldState } from './world.ts';

type LifeStage = 'baby' | 'child' | 'teen' | 'adult';

export interface MovableAgent {
  id: string;
  x: number;
  y: number;
  lifeStage: LifeStage;
  speed: number;
  homeX: number;
  homeY: number;
  caregiverId: string | null;
  explorationBias: number;
  brain: BrainState;
  brainDecision: BrainDecision | null;
}

export interface MovementContext {
  world: WorldState;
  agentsById: Map<string, MovableAgent>;
}

const EPSILON = 1e-6;

interface WeightConfig {
  base: number;
  tags?: Record<string, number>;
}

interface StageMovementProfile {
  speedMultiplier: number;
  anchor: WeightConfig;
  radial: WeightConfig;
  random: WeightConfig;
}

const STAGE_PROFILES: Record<Exclude<LifeStage, 'baby'>, StageMovementProfile> = {
  child: {
    speedMultiplier: 0.6,
    anchor: {
      base: 1.2,
      tags: {
        fear: 0.6,
        safety: 0.5,
        home: 0.3,
        social: 0.2,
        outward: -0.6,
        curiosity: -0.3,
      },
    },
    radial: {
      base: 0.1,
      tags: {
        outward: 0.8,
        curiosity: 0.6,
        safety: -0.4,
        fear: -0.5,
        duty: -0.2,
      },
    },
    random: {
      base: 0.15,
      tags: {
        curiosity: 0.25,
        fear: -0.1,
      },
    },
  },
  teen: {
    speedMultiplier: 0.9,
    anchor: {
      base: 0.25,
      tags: {
        inward: 0.7,
        loyalty: 0.6,
        home: 0.5,
        resentment: -0.2,
      },
    },
    radial: {
      base: 0.7,
      tags: {
        outward: 0.4,
        risk: 0.5,
        border: 0.5,
        territorial: 0.4,
        inward: -0.6,
        loyalty: -0.4,
        home: -0.4,
      },
    },
    random: {
      base: 0.35,
      tags: {
        risk: 0.3,
        curiosity: 0.2,
      },
    },
  },
  adult: {
    speedMultiplier: 0.8,
    anchor: {
      base: 0.4,
      tags: {
        home: 0.6,
        inward: 0.8,
        rest: 0.4,
        social: 0.3,
      },
    },
    radial: {
      base: 0.4,
      tags: {
        outward: 0.8,
        work: 0.4,
        guard: 0.5,
        home: -0.5,
        inward: -0.7,
      },
    },
    random: {
      base: 0.2,
      tags: {
        outward: 0.2,
      },
    },
  },
};

export function moveAgent(agent: MovableAgent, context: MovementContext, stream: RngStream): void {
  if (agent.lifeStage === 'baby') {
    return;
  }

  const profile = STAGE_PROFILES[agent.lifeStage];
  if (!profile) {
    return;
  }

  const metadata = getCurrentNodeMetadata(agent.brain);
  const tags = metadata.tags;

  const outwardVector = vectorFrom(context.world.centerX, context.world.centerY, agent.x, agent.y);
  const outwardUnit = normalize(outwardVector.x, outwardVector.y);
  const inwardUnit = { x: -outwardUnit.x, y: -outwardUnit.y };

  const anchorTarget = resolveAnchorTarget(agent, context);
  const anchorVector = anchorTarget
    ? vectorFrom(agent.x, agent.y, anchorTarget.x, anchorTarget.y)
    : vectorFrom(agent.x, agent.y, agent.homeX, agent.homeY);
  const anchorUnit = normalize(anchorVector.x, anchorVector.y);

  const anchorWeight = evaluateWeight(profile.anchor, tags);
  let radialWeight = evaluateWeight(profile.radial, tags);
  const randomWeight = Math.max(0, evaluateWeight(profile.random, tags) + agent.explorationBias * 0.1);

  // Encourage adults to keep some connection to home even when radial weight pushes outward.
  if (agent.lifeStage === 'adult') {
    radialWeight += agent.explorationBias * 0.2 - anchorWeight * 0.1;
  }

  let velocityX = 0;
  let velocityY = 0;

  if (anchorWeight > EPSILON && anchorUnit.length > EPSILON) {
    velocityX += anchorUnit.x * anchorWeight;
    velocityY += anchorUnit.y * anchorWeight;
  }

  const radialUnit = radialWeight >= 0 ? outwardUnit : inwardUnit;
  const radialMagnitude = Math.abs(radialWeight);
  if (radialMagnitude > EPSILON && radialUnit.length > EPSILON) {
    velocityX += radialUnit.x * radialMagnitude;
    velocityY += radialUnit.y * radialMagnitude;
  }

  if (randomWeight > EPSILON) {
    const angle = stream.nextFloat() * Math.PI * 2;
    velocityX += Math.cos(angle) * randomWeight;
    velocityY += Math.sin(angle) * randomWeight;
  }

  const speed = Math.max(0, agent.speed * profile.speedMultiplier);
  const length = Math.hypot(velocityX, velocityY);
  if (length > EPSILON && speed > EPSILON) {
    const scale = speed / length;
    velocityX *= scale;
    velocityY *= scale;
  } else {
    velocityX = 0;
    velocityY = 0;
  }

  const nextX = agent.x + velocityX;
  const nextY = agent.y + velocityY;
  const clamped = clampPosition(context.world, nextX, nextY);
  agent.x = clamped.x;
  agent.y = clamped.y;
}

function resolveAnchorTarget(agent: MovableAgent, context: MovementContext): { x: number; y: number } | null {
  if (!agent.caregiverId) {
    return null;
  }
  const caregiver = context.agentsById.get(agent.caregiverId);
  if (!caregiver) {
    return null;
  }
  return { x: caregiver.x, y: caregiver.y };
}

function evaluateWeight(config: WeightConfig, tags: readonly string[]): number {
  let value = config.base;
  if (config.tags) {
    for (const tag of tags) {
      const delta = config.tags[tag];
      if (typeof delta === 'number') {
        value += delta;
      }
    }
  }
  return value;
}

function vectorFrom(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  return { x: bx - ax, y: by - ay };
}

function normalize(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  if (length <= EPSILON) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}
