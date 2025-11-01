import {
  getCurrentNodeMetadata,
  type BrainDecision,
  type BrainNodeMetadata,
  type BrainState,
} from './brain.ts';
import type { CityState, HouseState } from './collectives.ts';
import type { RngStream } from './rng.ts';
import {
  clampPosition,
  getForestResourceAt,
  isForestTile,
  isWithinBounds,
  type WorldState,
} from './world.ts';

type LifeStage = 'baby' | 'child' | 'teen' | 'adult';

export interface MovementTarget {
  x: number;
  y: number;
}

export interface MovementState {
  behaviorId: string | null;
  target: MovementTarget | null;
  waypoints: MovementTarget[] | null;
  waypointIndex: number;
  timer: number;
  lingerTicks: number;
  data: Record<string, unknown>;
  sameNodeId: string | null;
  sameNodeTicks: number;
  sameNodeLimit: number;
}

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
  houseId: string | null;
  traitFlags: string[];
  movement: MovementState;
}

export interface MovementContext {
  world: WorldState;
  agentsById: Map<string, MovableAgent>;
  housesById: Map<string, HouseState>;
  city: CityState | null;
  tick: number;
}

interface MovementBehaviorScoreInput {
  agent: MovableAgent;
  metadata: BrainNodeMetadata;
  tags: readonly string[];
  traitFlags: readonly string[];
  house: HouseState | null;
  houseDemand: Record<string, number>;
  city: CityState | null;
  context: MovementContext;
}

interface MovementBehaviorResult {
  target?: MovementTarget | null;
  waypoints?: MovementTarget[] | null;
  waypointIndex?: number;
  timer?: number;
  lingerTicks?: number;
  data?: Record<string, unknown>;
  satisfied?: boolean;
}

interface MovementBehavior {
  id: string;
  score(input: MovementBehaviorScoreInput): number;
  initialize?(
    agent: MovableAgent,
    state: MovementState,
    context: MovementContext,
    stream: RngStream,
    input: MovementBehaviorScoreInput,
  ): MovementBehaviorResult | void;
  update(
    agent: MovableAgent,
    state: MovementState,
    context: MovementContext,
    stream: RngStream,
    input: MovementBehaviorScoreInput,
  ): MovementBehaviorResult;
}

const EPSILON = 1e-6;
const TARGET_REACH_SQ = 0.9 * 0.9;
const PATROL_REACH_SQ = 1.35 * 1.35;
const DEFAULT_SAME_NODE_LIMIT = 8;

const behaviorRegistry = new Map<string, MovementBehavior>();

export function registerMovementBehavior(behavior: MovementBehavior): void {
  behaviorRegistry.set(behavior.id, behavior);
}

export function createInitialMovementState(): MovementState {
  return {
    behaviorId: null,
    target: null,
    waypoints: null,
    waypointIndex: 0,
    timer: 0,
    lingerTicks: 0,
    data: {},
    sameNodeId: null,
    sameNodeTicks: 0,
    sameNodeLimit: DEFAULT_SAME_NODE_LIMIT,
  };
}

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

  updateSameNodeState(agent, metadata);
  updateMovementBehavior(agent, metadata, context, stream);

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

  let speed = Math.max(0, agent.speed * profile.speedMultiplier);
  const movementTarget = agent.movement.target;
  if (movementTarget && isCloseTo(agent, movementTarget, TARGET_REACH_SQ)) {
    if (agent.movement.lingerTicks > 0) {
      agent.movement.lingerTicks -= 1;
      speed *= 0.25;
    }
  }

  agent.movement.timer = Math.max(0, agent.movement.timer - 1);

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

function updateSameNodeState(agent: MovableAgent, metadata: BrainNodeMetadata): void {
  const state = agent.movement;
  const limit = Math.max(
    4,
    Math.round(metadata.duration * (1.5 + agent.explorationBias * 1.2)),
  );

  if (state.sameNodeId !== metadata.id) {
    state.sameNodeId = metadata.id;
    state.sameNodeTicks = 0;
    state.sameNodeLimit = limit;
    return;
  }

  state.sameNodeTicks += 1;
  state.sameNodeLimit = Math.max(4, Math.min(state.sameNodeLimit, limit));

  if (state.sameNodeTicks > state.sameNodeLimit) {
    clearMovementBehavior(state);
    state.sameNodeTicks = 0;
    state.sameNodeLimit = Math.max(4, Math.floor(limit * 0.7));
  }
}

function updateMovementBehavior(
  agent: MovableAgent,
  metadata: BrainNodeMetadata,
  context: MovementContext,
  stream: RngStream,
): void {
  const state = agent.movement;
  const input = buildBehaviorInput(agent, metadata, context);

  if (state.behaviorId) {
    const behavior = behaviorRegistry.get(state.behaviorId);
    if (!behavior) {
      clearMovementBehavior(state);
    } else {
      const result = behavior.update(agent, state, context, stream, input);
      const satisfied = applyBehaviorResult(state, result, context.world);
      if (satisfied) {
        clearMovementBehavior(state);
      }
    }
  }

  if (!state.behaviorId) {
    const selection = selectMovementBehavior(input, stream);
    if (!selection) {
      state.target = state.target ?? null;
      return;
    }

    activateMovementBehavior(selection, agent, state, context, stream, input);
  }
}

function activateMovementBehavior(
  behavior: MovementBehavior,
  agent: MovableAgent,
  state: MovementState,
  context: MovementContext,
  stream: RngStream,
  input: MovementBehaviorScoreInput,
): void {
  clearMovementBehavior(state);
  state.behaviorId = behavior.id;
  state.data = {};

  const initResult = behavior.initialize?.(agent, state, context, stream, input);
  if (initResult) {
    const satisfied = applyBehaviorResult(state, initResult, context.world);
    if (satisfied) {
      clearMovementBehavior(state);
      return;
    }
  }

  const updateResult = behavior.update(agent, state, context, stream, input);
  const satisfied = applyBehaviorResult(state, updateResult, context.world);
  if (satisfied) {
    clearMovementBehavior(state);
  }
}

function clearMovementBehavior(state: MovementState): void {
  state.behaviorId = null;
  state.target = null;
  state.timer = 0;
  state.lingerTicks = 0;
  state.waypoints = null;
  state.waypointIndex = 0;
  state.data = {};
}

function buildBehaviorInput(
  agent: MovableAgent,
  metadata: BrainNodeMetadata,
  context: MovementContext,
): MovementBehaviorScoreInput {
  const house = agent.houseId ? context.housesById.get(agent.houseId) ?? null : null;
  const houseDemand: Record<string, number> = {};
  if (house) {
    for (const [key, value] of Object.entries(house.activeDemand ?? {})) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        houseDemand[key] = numeric;
      }
    }
  }

  return {
    agent,
    metadata,
    tags: metadata.tags,
    traitFlags: agent.traitFlags,
    house,
    houseDemand,
    city: context.city,
    context,
  };
}

function selectMovementBehavior(input: MovementBehaviorScoreInput, stream: RngStream): MovementBehavior | null {
  let best: MovementBehavior | null = null;
  let bestScore = 0;

  for (const behavior of behaviorRegistry.values()) {
    const score = behavior.score(input);
    if (score <= 0) {
      continue;
    }
    const adjustedScore = score + stream.nextFloat() * 0.01;
    if (!best || adjustedScore > bestScore) {
      best = behavior;
      bestScore = adjustedScore;
    }
  }

  return best;
}

function applyBehaviorResult(
  state: MovementState,
  result: MovementBehaviorResult | void,
  world: WorldState,
): boolean {
  if (!result) {
    return false;
  }

  if (result.target !== undefined) {
    state.target = result.target ? clampPosition(world, result.target.x, result.target.y) : null;
  }

  if (result.waypoints !== undefined) {
    state.waypoints = result.waypoints;
  }

  if (typeof result.waypointIndex === 'number') {
    state.waypointIndex = result.waypointIndex;
  }

  if (typeof result.timer === 'number' && Number.isFinite(result.timer)) {
    state.timer = Math.max(0, Math.floor(result.timer));
  }

  if (typeof result.lingerTicks === 'number' && Number.isFinite(result.lingerTicks)) {
    state.lingerTicks = Math.max(0, Math.floor(result.lingerTicks));
  }

  if (result.data) {
    state.data = { ...state.data, ...result.data };
  }

  return Boolean(result.satisfied);
}

function resolveAnchorTarget(agent: MovableAgent, context: MovementContext): MovementTarget | null {
  if (agent.movement.target) {
    return agent.movement.target;
  }

  const caregiver = agent.caregiverId ? context.agentsById.get(agent.caregiverId) ?? null : null;
  if (caregiver) {
    return { x: caregiver.x, y: caregiver.y };
  }

  const house = agent.houseId ? context.housesById.get(agent.houseId) ?? null : null;
  if (house) {
    return { x: house.x, y: house.y };
  }

  if (context.city) {
    return { x: context.city.x, y: context.city.y };
  }

  return { x: agent.homeX, y: agent.homeY };
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

function isCloseTo(agent: MovableAgent, target: MovementTarget, reachSq: number): boolean {
  const dx = agent.x - target.x;
  const dy = agent.y - target.y;
  return dx * dx + dy * dy <= reachSq;
}

function getAnchorForAgent(
  input: MovementBehaviorScoreInput,
  contextFallback: MovementContext,
): MovementTarget {
  if (input.house) {
    return { x: input.house.x, y: input.house.y };
  }
  if (input.city) {
    return { x: input.city.x, y: input.city.y };
  }
  return { x: input.agent.homeX, y: input.agent.homeY };
}

function pickRandomPointNear(
  anchorX: number,
  anchorY: number,
  radius: number,
  world: WorldState,
  stream: RngStream,
): MovementTarget {
  const angle = stream.nextFloat() * Math.PI * 2;
  const distance = Math.max(0.5, radius * (0.4 + stream.nextFloat() * 0.6));
  const x = anchorX + Math.cos(angle) * distance;
  const y = anchorY + Math.sin(angle) * distance;
  return clampPosition(world, x, y);
}

function buildPatrolLoop(
  anchor: MovementTarget,
  radius: number,
  world: WorldState,
  stream: RngStream,
): MovementTarget[] {
  const points: MovementTarget[] = [];
  const count = 4;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + stream.nextFloat() * 0.3;
    const offset = radius * (0.7 + stream.nextFloat() * 0.5);
    const x = anchor.x + Math.cos(angle) * offset;
    const y = anchor.y + Math.sin(angle) * offset;
    points.push(clampPosition(world, x, y));
  }
  return points;
}

function ensureHarvestTarget(
  agent: MovableAgent,
  state: MovementState,
  input: MovementBehaviorScoreInput,
  context: MovementContext,
  stream: RngStream,
): MovementTarget {
  const cached = state.data.harvestTarget;
  if (cached && typeof cached === 'object' && cached) {
    const target = cached as MovementTarget;
    if (isForestTile(context.world, target.x, target.y)) {
      const resources = getForestResourceAt(context.world, target.x, target.y);
      if (resources > 0.2) {
        return target;
      }
    }
  }

  const anchor = getAnchorForAgent(input, context);
  const attempts = 12;
  const world = context.world;
  const worldRadius = Math.hypot(world.centerX, world.centerY) || 1;
  const baseRadius = 4 + agent.explorationBias * 6;

  const hasNearbyForest = hasForestWithinRadius(world, anchor, Math.max(6, baseRadius * 0.8));
  const distanceToForestRing = hasNearbyForest
    ? 0
    : estimateDistanceToForestRing(world, anchor, worldRadius);

  let minRadius = Math.max(3, baseRadius);
  if (distanceToForestRing > 0) {
    minRadius = Math.max(minRadius, distanceToForestRing + 1.5);
  }
  minRadius = Math.min(minRadius, worldRadius);

  const worldScaleRange = Math.max(6, worldRadius * (0.12 + agent.explorationBias * 0.18));
  const maxRadius = Math.min(worldRadius, Math.max(minRadius + 1, minRadius + worldScaleRange));

  let best: MovementTarget = clampPosition(context.world, anchor.x, anchor.y);
  let bestResources = 0;

  for (let i = 0; i < attempts; i += 1) {
    const radiusRange = Math.max(0, maxRadius - minRadius);
    const radius =
      radiusRange <= 0.5
        ? minRadius
        : minRadius + stream.nextFloat() * radiusRange;
    const candidate = pickRandomPointNear(anchor.x, anchor.y, radius, context.world, stream);
    if (!isForestTile(context.world, candidate.x, candidate.y)) {
      continue;
    }
    const resources = getForestResourceAt(context.world, candidate.x, candidate.y);
    if (resources > bestResources) {
      bestResources = resources;
      best = candidate;
    }
    if (bestResources > 0.5) {
      break;
    }
  }

  if (bestResources <= 0) {
    const fallback = findForestAlongDirections(world, anchor, worldRadius, stream);
    if (fallback) {
      best = fallback.target;
      bestResources = fallback.resources;
    }
  }

  state.data.harvestTarget = best;
  return best;
}

interface ForestTargetCandidate {
  target: MovementTarget;
  resources: number;
}

function findForestAlongDirections(
  world: WorldState,
  anchor: MovementTarget,
  maxDistance: number,
  stream: RngStream,
): ForestTargetCandidate | null {
  const directions = buildForestSearchDirections(world, anchor, stream);
  let best: ForestTargetCandidate | null = null;

  for (const direction of directions) {
    const target = traceForestAlongDirection(world, anchor, direction, maxDistance);
    if (!target) {
      continue;
    }
    const resources = getForestResourceAt(world, target.x, target.y);
    if (!best || resources > best.resources) {
      best = { target, resources };
    }
    if (best && best.resources > 0.5) {
      break;
    }
  }

  return best;
}

function buildForestSearchDirections(
  world: WorldState,
  anchor: MovementTarget,
  stream: RngStream,
): Array<{ x: number; y: number }> {
  const directions: Array<{ x: number; y: number }> = [];
  const dx = anchor.x - world.centerX;
  const dy = anchor.y - world.centerY;
  const length = Math.hypot(dx, dy);

  if (length > EPSILON) {
    directions.push({ x: dx / length, y: dy / length });
  }

  const baseAngle = stream.nextFloat() * Math.PI * 2;
  const steps = 6;
  for (let i = 0; i < steps; i += 1) {
    const angle = baseAngle + (Math.PI * 2 * i) / steps;
    directions.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }

  return directions;
}

function traceForestAlongDirection(
  world: WorldState,
  anchor: MovementTarget,
  direction: { x: number; y: number },
  maxDistance: number,
): MovementTarget | null {
  const norm = Math.hypot(direction.x, direction.y);
  if (norm <= EPSILON) {
    return null;
  }
  const dirX = direction.x / norm;
  const dirY = direction.y / norm;
  const stepSize = 0.75;
  const steps = Math.max(1, Math.ceil(maxDistance / stepSize));

  for (let step = 1; step <= steps; step += 1) {
    const distance = step * stepSize;
    const sampleX = anchor.x + dirX * distance;
    const sampleY = anchor.y + dirY * distance;
    const tileX = Math.floor(sampleX);
    const tileY = Math.floor(sampleY);
    if (!isWithinBounds(world, tileX, tileY)) {
      break;
    }
    if (isForestTile(world, sampleX, sampleY)) {
      return clampPosition(world, sampleX, sampleY);
    }
  }

  return null;
}

function hasForestWithinRadius(world: WorldState, anchor: MovementTarget, radius: number): boolean {
  const searchRadius = Math.max(0, radius);
  const minX = Math.max(0, Math.floor(anchor.x - searchRadius));
  const maxX = Math.min(world.width - 1, Math.ceil(anchor.x + searchRadius));
  const minY = Math.max(0, Math.floor(anchor.y - searchRadius));
  const maxY = Math.min(world.height - 1, Math.ceil(anchor.y + searchRadius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isForestTile(world, x, y)) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        if (dx * dx + dy * dy <= searchRadius * searchRadius + EPSILON) {
          return true;
        }
      }
    }
  }

  return false;
}

function estimateDistanceToForestRing(
  world: WorldState,
  anchor: MovementTarget,
  worldRadius: number,
): number {
  if (isForestTile(world, anchor.x, anchor.y)) {
    return 0;
  }

  const dx = anchor.x - world.centerX;
  const dy = anchor.y - world.centerY;
  const distanceFromCenter = Math.hypot(dx, dy);
  const baseDirectionLength = Math.hypot(dx, dy);
  const direction =
    baseDirectionLength > EPSILON
      ? { x: dx / baseDirectionLength, y: dy / baseDirectionLength }
      : { x: 1, y: 0 };

  const maxSteps = Math.ceil(worldRadius);
  for (let step = 1; step <= maxSteps; step += 1) {
    const sampleX = anchor.x + direction.x * step;
    const sampleY = anchor.y + direction.y * step;
    const tileX = Math.floor(sampleX);
    const tileY = Math.floor(sampleY);
    if (!isWithinBounds(world, tileX, tileY)) {
      break;
    }
    if (isForestTile(world, sampleX, sampleY)) {
      return Math.hypot(sampleX - anchor.x, sampleY - anchor.y);
    }
  }

  return Math.max(0, worldRadius - distanceFromCenter);
}

function selectSocialAnchor(
  input: MovementBehaviorScoreInput,
  context: MovementContext,
  stream: RngStream,
): MovementTarget {
  if (input.house && input.house.members.length > 1) {
    return { x: input.house.x, y: input.house.y };
  }

  const houses = Array.from(context.housesById.values());
  if (houses.length > 0) {
    const candidate = houses[Math.floor(stream.nextFloat() * houses.length)];
    return { x: candidate.x, y: candidate.y };
  }

  if (input.city) {
    return { x: input.city.x, y: input.city.y };
  }

  return { x: input.context.world.centerX, y: input.context.world.centerY };
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

registerMovementBehavior({
  id: 'wander',
  score({ metadata, tags, agent }) {
    if (!tags.includes('outward') && metadata.id !== 'Wander' && !tags.includes('wander')) {
      return 0;
    }
    let score = 0.4 + agent.explorationBias * 0.5;
    if (metadata.id === 'Wander' || tags.includes('wander')) {
      score += 0.5;
    }
    if (tags.includes('guard') || tags.includes('build')) {
      score *= 0.6;
    }
    return score;
  },
  update(agent, state, context, stream, input) {
    let target = state.target;
    const shouldRetarget =
      !target ||
      state.timer <= 0 ||
      isCloseTo(agent, target, TARGET_REACH_SQ) ||
      !isWithinWorld(context.world, target);

    if (shouldRetarget) {
      const anchor = getAnchorForAgent(input, context);
      const radius = 4 + stream.nextFloat() * (8 + agent.explorationBias * 8);
      target = pickRandomPointNear(anchor.x, anchor.y, radius, context.world, stream);
      const linger = 1 + Math.floor(stream.nextFloat() * 3);
      return {
        target,
        timer: 5 + Math.floor(stream.nextFloat() * 5),
        lingerTicks: linger,
      };
    }

    if (state.lingerTicks > 0 && target) {
      return { target, lingerTicks: state.lingerTicks - 1 };
    }

    return { target };
  },
});

registerMovementBehavior({
  id: 'patrol',
  score({ tags, traitFlags, metadata, house }) {
    if (!tags.includes('guard') && !tags.includes('patrol') && metadata.id !== 'Patrol') {
      if (!traitFlags.includes('territorial')) {
        return 0;
      }
    }
    let score = 0.75;
    if (tags.includes('guard') || metadata.id === 'Patrol') {
      score += 0.4;
    }
    if (traitFlags.includes('territorial')) {
      score += 0.6;
    }
    if (!house) {
      score *= 0.8;
    }
    return score;
  },
  initialize(agent, state, context, stream, input) {
    const anchor = getAnchorForAgent(input, context);
    const baseRadius = input.house?.radius ?? 3;
    const radius = Math.max(3, baseRadius + 1.5 + agent.explorationBias * 3);
    const waypoints = buildPatrolLoop(anchor, radius, context.world, stream);
    const loops = 1 + Math.floor(stream.nextFloat() * (input.traitFlags.includes('territorial') ? 3 : 2));
    return {
      target: waypoints[0] ?? anchor,
      waypoints,
      waypointIndex: 0,
      timer: 8 + Math.floor(stream.nextFloat() * 6),
      data: { loopsRemaining: loops },
    };
  },
  update(agent, state, context, stream) {
    const waypoints = state.waypoints ?? [];
    if (waypoints.length === 0) {
      return { target: state.target };
    }

    let index = state.waypointIndex;
    let target = waypoints[Math.max(0, Math.min(waypoints.length - 1, index))];
    if (!target) {
      return { target: state.target };
    }

    if (isCloseTo(agent, target, PATROL_REACH_SQ)) {
      index = (index + 1) % waypoints.length;
      let loopsRemaining = coerceNumber(state.data.loopsRemaining, 1);
      if (index === 0) {
        loopsRemaining = Math.max(0, loopsRemaining - 1);
      }
      state.data.loopsRemaining = loopsRemaining;
      if (loopsRemaining <= 0) {
        return { target, satisfied: true };
      }
      target = waypoints[index];
      const linger = 1 + Math.floor(stream.nextFloat() * 2);
      return {
        target,
        waypointIndex: index,
        lingerTicks: linger,
      };
    }

    return { target, waypointIndex: index };
  },
});

registerMovementBehavior({
  id: 'build-forage',
  score({ tags, houseDemand, metadata }) {
    const buildTag = tags.includes('build') || tags.includes('work') || metadata.id === 'BuildDwelling';
    const woodSignal = houseDemand.wood ?? 0;
    const woodPressure = woodSignal > 1 ? woodSignal - 1 : 0;
    if (!buildTag && woodPressure <= 0) {
      return 0;
    }
    let score = 0.45;
    if (buildTag) {
      score += 0.5;
    }
    if (woodPressure > 0) {
      const cappedPressure = Math.min(woodPressure, 3);
      score += 0.65 + cappedPressure * 0.35;
    }
    return score;
  },
  initialize(agent, state) {
    state.data = { phase: 'harvest' };
    state.timer = 0;
  },
  update(agent, state, context, stream, input) {
    const phase = typeof state.data.phase === 'string' ? (state.data.phase as string) : 'harvest';
    if (phase === 'harvest') {
      const harvestTarget = ensureHarvestTarget(agent, state, input, context, stream);
      if (isCloseTo(agent, harvestTarget, TARGET_REACH_SQ * 1.2)) {
        const gatherTime = 2 + Math.floor(stream.nextFloat() * 4);
        state.data.phase = 'deliver';
        state.data.harvestTarget = harvestTarget;
        const anchor = getAnchorForAgent(input, context);
        state.data.deliverTarget = anchor;
        return {
          target: harvestTarget,
          lingerTicks: gatherTime,
          timer: gatherTime,
        };
      }
      return { target: harvestTarget, timer: state.timer > 0 ? state.timer : 6 };
    }

    const deliverTarget = (state.data.deliverTarget as MovementTarget) ?? getAnchorForAgent(input, context);
    const reach = Math.max(1.5, (input.house?.radius ?? 1) + 1.5);
    if (isCloseTo(agent, deliverTarget, reach * reach)) {
      state.data.phase = 'harvest';
      const lingering = 1 + Math.floor(stream.nextFloat() * 2);
      const stillNeedsWood = (input.houseDemand.wood ?? 0) > 1.05;
      return {
        target: deliverTarget,
        lingerTicks: lingering,
        satisfied: !stillNeedsWood,
      };
    }

    return { target: deliverTarget };
  },
});

registerMovementBehavior({
  id: 'social-visit',
  score({ tags, metadata, traitFlags }) {
    if (!tags.includes('social') && metadata.id !== 'Socialize') {
      return 0;
    }
    let score = 0.55;
    if (traitFlags.includes('steadfast')) {
      score += 0.2;
    }
    if (metadata.id === 'Socialize') {
      score += 0.3;
    }
    return score;
  },
  initialize(agent, state, context, stream, input) {
    const anchor = selectSocialAnchor(input, context, stream);
    const radius = 2 + stream.nextFloat() * 4;
    const target = pickRandomPointNear(anchor.x, anchor.y, radius, context.world, stream);
    return {
      target,
      timer: 6 + Math.floor(stream.nextFloat() * 4),
      lingerTicks: 2 + Math.floor(stream.nextFloat() * 3),
    };
  },
  update(agent, state, context, stream, input) {
    let target = state.target;
    if (!target || state.timer <= 0 || !isWithinWorld(context.world, target)) {
      const anchor = selectSocialAnchor(input, context, stream);
      const radius = 2 + stream.nextFloat() * 4;
      target = pickRandomPointNear(anchor.x, anchor.y, radius, context.world, stream);
      return {
        target,
        timer: 6 + Math.floor(stream.nextFloat() * 4),
        lingerTicks: 2 + Math.floor(stream.nextFloat() * 2),
      };
    }

    if (state.lingerTicks > 0 && target) {
      return { target, lingerTicks: state.lingerTicks - 1 };
    }

    return { target };
  },
});

function isWithinWorld(world: WorldState, target: MovementTarget): boolean {
  return target.x >= 0 && target.x <= world.width && target.y >= 0 && target.y <= world.height;
}

