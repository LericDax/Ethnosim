import adultMindRaw from '@shared/brains/AdultMind_v1.json?raw';
import babyMindRaw from '@shared/brains/BabyMind_v1.json?raw';
import childMindRaw from '@shared/brains/ChildMind_v1.json?raw';
import houseMindRaw from '@shared/brains/HouseMind_v1.json?raw';
import teenMindRaw from '@shared/brains/TeenMind_v1.json?raw';
import urbanMindRaw from '@shared/brains/UrbanMind_v1.json?raw';
import { JUMP_EDGE_DEFINITIONS } from './traits.ts';
import type { RngStream } from './rng.ts';
import {
  advancePlasticityState,
  applyPlasticityToWeight,
  createPlasticityState,
  registerPlasticityOutcome,
  type PlasticityEdgeState,
  type PlasticityState,
  type SerializedPlasticityState,
  type SerializedPlasticityEdgeState,
} from './plasticity.ts';
import {
  addScaledEmbedding,
  cloneEmbedding,
  combineTagEmbeddings,
  coerceEmbedding,
  createZeroEmbedding,
  dotProduct,
  embeddingFromTagWeights,
  isZeroEmbedding,
  normalizeEmbedding,
  scaleEmbedding,
} from './embeddings.ts';

export interface BrainNodeDefinition {
  id: string;
  base_freq: number;
  duration: number;
  tags: string[];
  charge_capacity?: number;
  charge_leak?: number;
  pulse_budget_scale?: number;
}

export type BrainEdgeDefinition = [string, string, number];

export interface BrainGraphDefinition {
  version: number;
  name: string;
  nodes: BrainNodeDefinition[];
  edges: BrainEdgeDefinition[];
  start_node: string;
}

export interface BrainNodeMetadata {
  id: string;
  baseFrequency: number;
  duration: number;
  tags: string[];
  chargeCapacity: number;
  chargeLeak: number;
  pulseBudgetScale: number;
  embedding: ReadonlyArray<number>;
}

interface BrainEdgeMetadata {
  targetId: string;
  weight: number;
}

interface BrainGraphRuntime {
  name: string;
  nodes: Map<string, BrainNodeMetadata>;
  edgesFrom: Map<string, BrainEdgeMetadata[]>;
  nodesByTag: Map<string, string[]>;
  startNodeId: string;
}

interface ActiveJumpEdgeState {
  id: string;
  sourceNodeIds: string[];
  targetNodeId: string;
  weight: number;
}

type JumpEdgeCooldownMap = Record<string, number>;

const LOW_MULTIPLIER_FAILURE_THRESHOLD = 0.35;

export type DecisionOutcomeCategory = 'resource' | 'mood' | 'directive';

export interface DecisionOutcomeBrainTuning {
  baseReward?: number;
  nodeScales?: Record<string, number>;
  tagScales?: Record<string, number>;
}

export interface DecisionOutcomeTuning {
  baseReward: number;
  nodeScales?: Record<string, number>;
  tagScales?: Record<string, number>;
  perBrain?: Record<string, DecisionOutcomeBrainTuning>;
}

interface ResolvedDecisionOutcomeTuning {
  baseReward: number;
  nodeScales: Record<string, number>;
  tagScales: Record<string, number>;
}

export const DECISION_OUTCOME_TUNING: Record<DecisionOutcomeCategory, DecisionOutcomeTuning> = {
  resource: {
    baseReward: 1,
  },
  mood: {
    baseReward: 0.6,
  },
  directive: {
    baseReward: 0.8,
  },
};

export interface DecisionOutcomeOptions {
  category: DecisionOutcomeCategory;
  magnitude?: number;
  fromNodeId?: string | null;
  toNodeId?: string | null;
  sign?: number;
  rewardOverride?: number;
  tags?: string[];
}

function resolveDecisionOutcomeTuning(
  category: DecisionOutcomeCategory,
  brainId: string,
): ResolvedDecisionOutcomeTuning | null {
  const base = DECISION_OUTCOME_TUNING[category];
  if (!base) {
    return null;
  }

  const overrides = base.perBrain?.[brainId];
  const baseReward =
    typeof overrides?.baseReward === 'number' && Number.isFinite(overrides.baseReward)
      ? overrides.baseReward
      : base.baseReward;

  const nodeScales: Record<string, number> = { ...(base.nodeScales ?? {}) };
  if (overrides?.nodeScales) {
    Object.assign(nodeScales, overrides.nodeScales);
  }

  const tagScales: Record<string, number> = { ...(base.tagScales ?? {}) };
  if (overrides?.tagScales) {
    Object.assign(tagScales, overrides.tagScales);
  }

  return {
    baseReward,
    nodeScales,
    tagScales,
  };
}

function resolveNodeScale(nodeId: string | null, tuning: ResolvedDecisionOutcomeTuning): number {
  if (!nodeId) {
    return 1;
  }
  const value = tuning.nodeScales[nodeId];
  return Number.isFinite(value) ? value : 1;
}

function resolveTagScale(tag: string, tuning: ResolvedDecisionOutcomeTuning): number {
  const value = tuning.tagScales[tag];
  return Number.isFinite(value) ? value : 1;
}

export function registerDecisionOutcome(state: BrainState, options: DecisionOutcomeOptions): void {
  if (!state || !options) {
    return;
  }

  const tuning = resolveDecisionOutcomeTuning(options.category, state.brainId);
  if (!tuning) {
    return;
  }

  const fallbackDecision = state.lastDecision;
  const sourceNodeId = options.fromNodeId ?? fallbackDecision?.fromNodeId ?? null;
  const targetNodeId = options.toNodeId ?? fallbackDecision?.chosenNodeId ?? null;
  if (!sourceNodeId || !targetNodeId) {
    return;
  }

  const rawBaseReward = options.rewardOverride ?? tuning.baseReward;
  if (!Number.isFinite(rawBaseReward) || rawBaseReward === 0) {
    return;
  }

  const magnitude =
    typeof options.magnitude === 'number' && Number.isFinite(options.magnitude)
      ? Math.max(0, Math.abs(options.magnitude))
      : 1;
  if (magnitude === 0) {
    return;
  }

  const baseSign = Math.sign(rawBaseReward) || 1;
  const requestedSign = Number.isFinite(options.sign ?? NaN) ? Math.sign(options.sign!) : baseSign;
  const sign = requestedSign === 0 ? baseSign : requestedSign;

  const brain = requireBrain(state.brainId);
  const sourceNode = brain.nodes.get(sourceNodeId) ?? null;
  const targetNode = brain.nodes.get(targetNodeId) ?? null;

  const nodeScale = resolveNodeScale(sourceNodeId, tuning) * resolveNodeScale(targetNodeId, tuning);
  if (!Number.isFinite(nodeScale) || nodeScale === 0) {
    return;
  }

  const tags = new Set<string>();
  if (sourceNode) {
    for (const tag of sourceNode.tags) {
      if (tag) {
        tags.add(tag);
      }
    }
  }
  if (targetNode) {
    for (const tag of targetNode.tags) {
      if (tag) {
        tags.add(tag);
      }
    }
  }
  if (Array.isArray(options.tags)) {
    for (const tag of options.tags) {
      if (typeof tag === 'string' && tag.length > 0) {
        tags.add(tag);
      }
    }
  }

  let tagScale = 1;
  for (const tag of tags) {
    const scale = resolveTagScale(tag, tuning);
    if (!Number.isFinite(scale) || scale === 0) {
      continue;
    }
    tagScale *= scale;
  }

  const totalScale = nodeScale * tagScale;
  if (!Number.isFinite(totalScale) || totalScale === 0) {
    return;
  }

  let reward = Math.abs(rawBaseReward) * magnitude * totalScale;
  reward *= sign;

  if (!Number.isFinite(reward) || reward === 0) {
    return;
  }

  registerPlasticityOutcome(state.plasticity, sourceNodeId, targetNodeId, reward);
}

export interface BrainDecisionFactor {
  nodeId: string;
  desirability: number;
  edgeWeight: number;
  baseWeight: number;
  plasticityAdjustment: number;
  baseFrequency: number;
  moodMultiplier: number;
  personalityMultiplier: number;
  demandMultiplier: number;
  relationshipMultiplier: number;
  totalMultiplier: number;
  attentionScore: number;
  embedding: ReadonlyArray<number>;
  tags: string[];
}

export interface BrainDecision {
  fromNodeId: string;
  candidates: BrainDecisionFactor[];
  chosenNodeId: string;
}

export interface BrainPulseAppearance {
  family?: string;
  color?: string;
  glow?: number;
  glowStrength?: number;
  glowColor?: string;
  glowSize?: number;
  glowOpacity?: number;
  size?: number;
  sizeBoost?: number;
  opacity?: number;
  opacityBoost?: number;
  brightness?: number;
  trailColor?: string;
  trailWidth?: number;
}

export type BrainPulsePaletteEntry = BrainPulseAppearance;

export type BrainPulsePalette = Record<string, BrainPulsePaletteEntry>;

interface BrainPulse {
  id: string;
  edgeKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  startedTick: number;
  travelDuration: number;
  elapsed: number;
  strength: number;
  payload: number;
  payloadRate: number;
  appearance?: BrainPulseAppearance;
}

export interface BrainPulseEvent {
  id: string;
  edgeKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  startedTick: number;
  travelDuration: number;
  strength: number;
  payload: number;
  payloadRate: number;
  appearance?: BrainPulseAppearance;
}

export interface RecentNodeChargeState extends NodeChargeState {
  ttl: number;
}

export interface RecentAssociationState {
  sourceId: string;
  targetId: string;
  weight: number;
  ttl: number;
  decay: number;
}

export interface BrainMigrationEdgeSnapshot {
  sourceId: string;
  targetId: string;
  state: PlasticityEdgeState;
}

export interface BrainMigrationAssociationSnapshot {
  sourceId: string;
  targetId: string;
  weight: number;
  ttl: number;
  decay: number;
}

export interface BrainMigrationSeed {
  sourceBrainId: string;
  targetBrainId?: string;
  plasticityTick: number;
  plasticityEdges: BrainMigrationEdgeSnapshot[];
  recentAssociations: BrainMigrationAssociationSnapshot[];
  contextEmbedding?: number[];
  sourceActiveNodeDuration?: number;
}

export interface BrainState {
  brainId: string;
  currentNodeId: string;
  nodeTimer: number;
  lastDecision: BrainDecision | null;
  traitFlags: string[];
  activeJumpEdges: Map<string, ActiveJumpEdgeState>;
  dynamicEdgesFrom: Map<string, BrainEdgeMetadata[]>;
  jumpEdgeCooldowns: JumpEdgeCooldownMap;
  plasticity: PlasticityState;
  pendingPulses: BrainPulse[];
  nodeCharge: Map<string, NodeChargeState>;
  recentCharge: Map<string, RecentNodeChargeState>;
  recentAssociations: Map<string, RecentAssociationState>;
  pulseEvents: BrainPulseEvent[];
  nextPulseId: number;
  contextEmbedding: number[];
  pendingContextEmbedding: number[];
}

export interface NodeChargeState {
  value: number;
  capacity: number;
}

export interface SerializedActiveJumpEdgeState {
  id: string;
  sourceNodeIds: string[];
  targetNodeId: string;
  weight: number;
}

export interface SerializedDynamicEdgeEntry {
  sourceId: string;
  targets: Array<{ targetId: string; weight: number }>;
}

interface SerializedRecentNodeChargeState extends SerializedNodeChargeState {
  ttl: number;
}

interface SerializedRecentAssociationState {
  sourceId: string;
  targetId: string;
  weight: number;
  ttl: number;
  decay: number;
}

export interface SerializedBrainState {
  brainId: string;
  currentNodeId: string;
  nodeTimer: number;
  lastDecision: BrainDecision | null;
  traitFlags: string[];
  activeJumpEdges: SerializedActiveJumpEdgeState[];
  dynamicEdgesFrom: SerializedDynamicEdgeEntry[];
  jumpEdgeCooldowns: JumpEdgeCooldownMap;
  plasticity: SerializedPlasticityState;
  pendingPulses: SerializedBrainPulse[];
  nodeCharge: Record<string, SerializedNodeChargeState>;
  recentCharge: Record<string, SerializedRecentNodeChargeState>;
  recentAssociations: SerializedRecentAssociationState[];
  pulseEvents: BrainPulseEvent[];
  nextPulseId: number;
  contextEmbedding: number[];
  pendingContextEmbedding: number[];
}

interface SerializedNodeChargeState {
  value: number;
  capacity: number;
}

interface SerializedBrainPulse {
  id: string;
  edgeKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  startedTick: number;
  travelDuration: number;
  elapsed: number;
  strength: number;
  payload: number;
  payloadRate: number;
  appearance?: BrainPulseAppearance;
}

export interface BrainMultiplierSet {
  mood?: Record<string, number>;
  personality?: Record<string, number>;
  demand?: Record<string, number>;
  relationship?: Record<string, number>;
}

interface BrainLibrary {
  [name: string]: BrainGraphRuntime;
}

const PULSE_THRESHOLD = 1;
const PULSE_EVENT_TTL = 128;
const PULSE_LEAK_MULTIPLIER = 0.96;
const PULSE_JITTER_RANGE = 0.18;
const PULSE_MAX_SPLITS_PER_EDGE = 4;
const PULSE_TARGET_PAYLOAD = 0.08;
const PULSE_MIN_PAYLOAD = 0.015;
const PULSE_PAYLOAD_JITTER_RANGE = 0.22;
const PULSE_TRAVEL_BASE_RATIO = 0.45;
const PULSE_TRAVEL_VARIANCE = 0.35;
const PULSE_TRAVEL_PAYLOAD_BIAS = 0.5;
const PULSE_TRAVEL_DURATION_JITTER = 0.18;
const PULSE_TRAVEL_MAX_RATIO = 1.8;
const PULSE_VISUAL_REFERENCE_PAYLOAD = 0.24;
const DEFAULT_CHARGE_CAPACITY = PULSE_THRESHOLD;
const DEFAULT_CHARGE_LEAK = PULSE_LEAK_MULTIPLIER;
const DEFAULT_PULSE_BUDGET_SCALE = 1;
const MIN_CHARGE_VALUE = 1e-4;
const RECENT_CHARGE_TTL = 2;
const RECENT_ASSOCIATION_TTL = 6;
const RECENT_ASSOCIATION_DECAY = 0.72;
const RECENT_ASSOCIATION_WEIGHT_SCALE = 1.1;
const RECENT_ASSOCIATION_MAX_WEIGHT = 1.35;
const RECENT_ASSOCIATION_MIN_WEIGHT = 0.05;
const CONTEXT_DECAY = 0.82;
const PULSE_CONTEXT_WEIGHT = 1;
const CURRENT_NODE_CONTEXT_WEIGHT = 0.35;
const MULTIPLIER_CONTEXT_WEIGHT_MOOD = 1;
const MULTIPLIER_CONTEXT_WEIGHT_PERSONALITY = 0.85;
const MULTIPLIER_CONTEXT_WEIGHT_DEMAND = 1.15;
const MULTIPLIER_CONTEXT_WEIGHT_RELATIONSHIP = 0.95;
const ATTENTION_GAIN = 0.75;
const ATTENTION_BLEND = 0.6;
const MIN_ATTENTION_SCORE = 0.05;

const RAW_BRAINS: BrainGraphDefinition[] = [
  parseBrainJson(babyMindRaw),
  parseBrainJson(childMindRaw),
  parseBrainJson(teenMindRaw),
  parseBrainJson(adultMindRaw),
  parseBrainJson(houseMindRaw),
  parseBrainJson(urbanMindRaw),
];

const BRAIN_LIBRARY: BrainLibrary = Object.fromEntries(
  RAW_BRAINS.map((definition) => [definition.name, buildRuntimeGraph(definition)]),
);

const DEFAULT_PULSE_PALETTE: BrainPulsePalette = Object.freeze({
  default: Object.freeze({
    family: 'default',
    color: '#7dd3fc',
    glowColor: 'rgba(125, 211, 252, 0.55)',
    glowStrength: 0.65,
    glowSize: 18,
    opacityBoost: 0.05,
    sizeBoost: 0.45,
    brightness: 0.9,
    trailColor: 'rgba(125, 211, 252, 0.32)',
    trailWidth: 1.25,
  }),
  social: Object.freeze({
    family: 'empathy',
    color: '#60a5fa',
    glowColor: 'rgba(96, 165, 250, 0.5)',
    glowStrength: 0.75,
    sizeBoost: 0.6,
    brightness: 1,
  }),
  need: Object.freeze({
    family: 'vital',
    color: '#facc15',
    glowColor: 'rgba(250, 204, 21, 0.45)',
    glowStrength: 0.8,
    sizeBoost: 0.5,
    brightness: 1.1,
  }),
  rest: Object.freeze({
    family: 'calm',
    color: '#38bdf8',
    glowColor: 'rgba(56, 189, 248, 0.45)',
    glowStrength: 0.5,
    brightness: 0.85,
  }),
  fear: Object.freeze({
    family: 'danger',
    color: '#f87171',
    glowColor: 'rgba(248, 113, 113, 0.48)',
    glowStrength: 1.1,
    brightness: 1.25,
    opacityBoost: 0.12,
  }),
  alert: Object.freeze({
    family: 'danger',
    color: '#f97316',
    glowColor: 'rgba(249, 115, 22, 0.48)',
    glowStrength: 0.95,
    brightness: 1.2,
  }),
  learn: Object.freeze({
    family: 'insight',
    color: '#a855f7',
    glowColor: 'rgba(168, 85, 247, 0.55)',
    glowStrength: 0.85,
    sizeBoost: 0.3,
  }),
  curiosity: Object.freeze({
    family: 'insight',
    glowStrength: 0.65,
    sizeBoost: 0.35,
  }),
  duty: Object.freeze({
    family: 'resolve',
    color: '#22d3ee',
    glowColor: 'rgba(34, 211, 238, 0.48)',
    glowStrength: 0.7,
    brightness: 0.95,
  }),
  loyalty: Object.freeze({
    family: 'resolve',
    color: '#0ea5e9',
    glowColor: 'rgba(14, 165, 233, 0.5)',
    glowStrength: 0.9,
    sizeBoost: 0.25,
  }),
  ritual: Object.freeze({
    family: 'mystic',
    color: '#c084fc',
    glowColor: 'rgba(192, 132, 252, 0.52)',
    glowStrength: 1,
    brightness: 1.15,
  }),
  home: Object.freeze({
    family: 'calm',
    color: '#5eead4',
    glowColor: 'rgba(94, 234, 212, 0.42)',
    glowStrength: 0.55,
    brightness: 0.95,
  }),
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value <= min) {
    return min;
  }
  if (value >= max) {
    return max;
  }
  return value;
}

function clonePulseAppearance(
  appearance: BrainPulseAppearance | undefined,
): BrainPulseAppearance | undefined {
  if (!appearance) {
    return undefined;
  }
  return { ...appearance } satisfies BrainPulseAppearance;
}

function resolvePulseAppearance(
  tags: string[],
  strength: number,
  palette: BrainPulsePalette,
): BrainPulseAppearance | undefined {
  const baseEntry = palette.default ? { ...palette.default } : {};
  let matched = false;
  for (const tag of tags) {
    if (!tag) {
      continue;
    }
    const entry = palette[tag];
    if (!entry) {
      continue;
    }
    matched = true;
    Object.assign(baseEntry, entry);
  }

  if (!matched && palette.neutral) {
    Object.assign(baseEntry, palette.neutral);
  }

  const resolved: BrainPulseAppearance = { ...baseEntry };
  if (!resolved.family && matched) {
    const firstTag = tags.find((tag) => Boolean(palette[tag]?.family));
    if (firstTag && palette[firstTag]?.family) {
      resolved.family = palette[firstTag]!.family;
    }
  }

  const ratio = clamp01(strength * 4);
  const brightness = resolved.brightness ?? 0.75 + ratio * 0.4;
  resolved.brightness = clamp(brightness, 0.1, 2.5);

  const glowStrength = resolved.glowStrength ?? resolved.glow ?? 0;
  if (Number.isFinite(glowStrength) && glowStrength > 0) {
    const normalizedGlow = clamp(glowStrength, 0, 2);
    resolved.glowStrength = normalizedGlow;
    resolved.glow = normalizedGlow;
    if (resolved.glowSize == null) {
      resolved.glowSize = 14 + normalizedGlow * 8;
    }
    if (resolved.glowOpacity == null) {
      resolved.glowOpacity = clamp(0.35 + normalizedGlow * 0.25, 0.2, 0.85);
    }
  } else {
    resolved.glowStrength = undefined;
    resolved.glow = undefined;
  }

  if (resolved.sizeBoost == null) {
    resolved.sizeBoost = 0;
  }
  if (resolved.opacityBoost == null) {
    resolved.opacityBoost = 0;
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function parseBrainJson(raw: string): BrainGraphDefinition {
  try {
    const parsed = JSON.parse(raw) as BrainGraphDefinition;
    return parsed;
  } catch (error) {
    throw new Error('Failed to parse brain JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
}

function normalizeChargeCapacity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= MIN_CHARGE_VALUE) {
    return DEFAULT_CHARGE_CAPACITY;
  }
  return numeric;
}

function normalizeChargeLeak(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CHARGE_LEAK;
  }
  if (numeric <= 0) {
    return DEFAULT_CHARGE_LEAK;
  }
  if (numeric >= 1) {
    return 1;
  }
  return numeric;
}

function normalizePulseBudgetScale(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_PULSE_BUDGET_SCALE;
  }
  return numeric;
}

function getNodeChargeCapacity(metadata: BrainNodeMetadata | undefined): number {
  return metadata?.chargeCapacity ?? DEFAULT_CHARGE_CAPACITY;
}

function getNodeChargeLeak(metadata: BrainNodeMetadata | undefined): number {
  return metadata?.chargeLeak ?? DEFAULT_CHARGE_LEAK;
}

function getPulseBudgetScale(metadata: BrainNodeMetadata | undefined): number {
  return metadata?.pulseBudgetScale ?? DEFAULT_PULSE_BUDGET_SCALE;
}

function setNodeChargeState(
  state: BrainState,
  nodeId: string,
  value: number,
  capacity: number,
): void {
  if (value <= MIN_CHARGE_VALUE) {
    state.nodeCharge.delete(nodeId);
    if (state.recentCharge.has(nodeId)) {
      state.recentCharge.delete(nodeId);
    }
    return;
  }
  const normalizedCapacity = capacity > MIN_CHARGE_VALUE ? capacity : DEFAULT_CHARGE_CAPACITY;
  state.nodeCharge.set(nodeId, { value, capacity: normalizedCapacity });
  if (state.recentCharge.has(nodeId)) {
    state.recentCharge.delete(nodeId);
  }
}

function buildRuntimeGraph(definition: BrainGraphDefinition): BrainGraphRuntime {
  const nodes = new Map<string, BrainNodeMetadata>();
  const nodesByTag = new Map<string, string[]>();
  for (const node of definition.nodes) {
    const chargeCapacity = normalizeChargeCapacity(node.charge_capacity);
    const chargeLeak = normalizeChargeLeak(node.charge_leak);
    const pulseBudgetScale = normalizePulseBudgetScale(node.pulse_budget_scale);
    const tags = Array.isArray(node.tags) ? [...node.tags] : [];
    const embedding = Object.freeze(combineTagEmbeddings(tags));
    nodes.set(node.id, {
      id: node.id,
      baseFrequency: node.base_freq,
      duration: node.duration,
      tags,
      chargeCapacity,
      chargeLeak,
      pulseBudgetScale,
      embedding,
    });

    for (const tag of tags) {
      if (!nodesByTag.has(tag)) {
        nodesByTag.set(tag, []);
      }
      nodesByTag.get(tag)!.push(node.id);
    }
  }

  const edgesFrom = new Map<string, BrainEdgeMetadata[]>();
  for (const [sourceId, targetId, weight] of definition.edges) {
    if (!edgesFrom.has(sourceId)) {
      edgesFrom.set(sourceId, []);
    }
    edgesFrom.get(sourceId)!.push({
      targetId,
      weight,
    });
  }

  return {
    name: definition.name,
    nodes,
    edgesFrom,
    nodesByTag,
    startNodeId: definition.start_node,
  };
}

function requireBrain(brainId: string): BrainGraphRuntime {
  const brain = BRAIN_LIBRARY[brainId];
  if (!brain) {
    throw new Error(`Unknown brain graph: ${brainId}`);
  }
  return brain;
}

function requireNode(brain: BrainGraphRuntime, nodeId: string): BrainNodeMetadata {
  const node = brain.nodes.get(nodeId);
  if (!node) {
    throw new Error(`Unknown brain node ${nodeId} for brain ${brain.name}`);
  }
  return node;
}

function productForTags(tags: string[], map?: Record<string, number>): number {
  if (!map) {
    return 1;
  }
  let product = 1;
  for (const tag of tags) {
    const value = map[tag];
    if (typeof value === 'number' && Number.isFinite(value)) {
      product *= value;
    }
  }
  return product;
}

function moodLevelToMultiplier(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return 1;
  }
  if (numeric > 0) {
    const capped = Math.min(numeric, 8);
    return 1 + capped;
  }
  const magnitude = Math.min(Math.abs(numeric), 8);
  return 1 / (1 + magnitude);
}

function combineMoodMultipliers(
  base: Record<string, number> | undefined,
  moodLevels: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const combined: Record<string, number> = {};
  const applyScale = (key: string, scale: number): void => {
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
      return;
    }
    const existing = combined[key] ?? 1;
    combined[key] = existing * scale;
  };
  if (base) {
    for (const [tag, value] of Object.entries(base)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        continue;
      }
      combined[tag] = numeric;
    }
  }
  if (moodLevels) {
    for (const [tag, value] of Object.entries(moodLevels)) {
      const multiplier = moodLevelToMultiplier(value);
      if (!Number.isFinite(multiplier) || Math.abs(multiplier - 1) < 1e-6) {
        continue;
      }
      const existing = combined[tag] ?? 1;
      combined[tag] = existing * multiplier;
    }
    const rawUnhoused = moodLevels.unhoused;
    const unhousedLevel = Number(rawUnhoused);
    if (Number.isFinite(unhousedLevel) && unhousedLevel > 0) {
      const capped = Math.min(unhousedLevel, 3);
      applyScale('home', 1 + capped * 0.45);
      applyScale('build', 1 + capped * 0.6);
      applyScale('work', 1 + capped * 0.35);
    }
  }
  return Object.keys(combined).length > 0 ? combined : undefined;
}

function applyMultiplierScale(map: Record<string, number>, tag: string, scale: number): boolean {
  if (!map || !tag) {
    return false;
  }
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
    return false;
  }
  const existing = map[tag];
  if (typeof existing === 'number' && Number.isFinite(existing) && existing > 0) {
    map[tag] = existing * scale;
  } else {
    map[tag] = scale;
  }
  return true;
}

function createEffectiveMultipliers(
  brainId: string,
  multipliers: BrainMultiplierSet = {},
  moodLevels: Record<string, number> = {},
): BrainMultiplierSet {
  const effective: BrainMultiplierSet = {};
  const mood = combineMoodMultipliers(multipliers.mood, moodLevels);
  if (mood) {
    effective.mood = mood;
  }
  if (multipliers.personality) {
    effective.personality = { ...multipliers.personality };
  }
  if (multipliers.demand) {
    effective.demand = { ...multipliers.demand };
  }
  if (multipliers.relationship) {
    effective.relationship = { ...multipliers.relationship };
  }

  if (brainId === 'TeenMind_v1') {
    let relationshipMap = effective.relationship;
    let demandMap = effective.demand;
    let relationshipChanged = false;
    let demandChanged = false;

    const loyaltyNeed = Number(moodLevels.loyalty);
    if (Number.isFinite(loyaltyNeed) && loyaltyNeed > 0.45) {
      const capped = Math.min(2.5, Math.max(0, loyaltyNeed));
      const bondingScale = 1 + capped * 0.25;
      const futureScale = 1 + capped * 0.22;
      const loyaltyScale = 1 + capped * 0.2;
      if (!relationshipMap) {
        relationshipMap = {};
      }
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'bonding', bondingScale) || relationshipChanged;
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'future_pair', futureScale) || relationshipChanged;
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'loyalty', loyaltyScale) || relationshipChanged;
    }

    const dutyNeed = Number(moodLevels.duty);
    if (Number.isFinite(dutyNeed) && dutyNeed > 0.45) {
      const capped = Math.min(2.5, Math.max(0, dutyNeed));
      const dutyScale = 1 + capped * 0.3;
      const dutyRelationshipScale = 1 + capped * 0.18;
      const borderScale = 1 + capped * 0.22;
      const resolveScale = 1 + capped * 0.16;
      if (!demandMap) {
        demandMap = {};
      }
      demandChanged = applyMultiplierScale(demandMap, 'duty', dutyScale) || demandChanged;
      if (!relationshipMap) {
        relationshipMap = {};
      }
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'duty', dutyRelationshipScale) || relationshipChanged;
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'border', borderScale) || relationshipChanged;
      relationshipChanged =
        applyMultiplierScale(relationshipMap, 'resolve', resolveScale) || relationshipChanged;
    }

    if (relationshipChanged && relationshipMap) {
      effective.relationship = relationshipMap;
    }
    if (demandChanged && demandMap) {
      effective.demand = demandMap;
    }
  }
  return effective;
}

function buildMultiplierEmbedding(multipliers: BrainMultiplierSet): number[] {
  const components: { vector: number[]; weight: number }[] = [];
  const moodMap = multipliers.mood;
  const rawUnhoused = moodMap ? moodMap.unhoused : undefined;
  const unhousedPressure =
    typeof rawUnhoused === 'number' && Number.isFinite(rawUnhoused) && rawUnhoused > 1
      ? Math.min(2.5, rawUnhoused - 1)
      : 0;

  const adjustMood = (map: Record<string, number>, key: string, scale: number): void => {
    if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
      return;
    }
    const current = map[key];
    if (typeof current === 'number' && Number.isFinite(current) && current > 0) {
      map[key] = current * scale;
    } else {
      map[key] = scale;
    }
  };

  let adjustedMoodMap: Record<string, number> | undefined;
  if (moodMap) {
    adjustedMoodMap = { ...moodMap };
  } else if (unhousedPressure > 0) {
    adjustedMoodMap = {};
  }

  if (adjustedMoodMap && unhousedPressure > 0) {
    adjustMood(adjustedMoodMap, 'home', 1 + unhousedPressure * 0.5);
    adjustMood(adjustedMoodMap, 'build', 1 + unhousedPressure * 0.7);
    adjustMood(adjustedMoodMap, 'work', 1 + unhousedPressure * 0.45);
    adjustMood(adjustedMoodMap, 'outward', 1 + unhousedPressure * 0.3);
  }

  if (adjustedMoodMap) {
    const moodEmbedding = embeddingFromTagWeights(adjustedMoodMap, MULTIPLIER_CONTEXT_WEIGHT_MOOD);
    if (!isZeroEmbedding(moodEmbedding)) {
      components.push({ vector: moodEmbedding, weight: 1 });
    }
  }
  if (multipliers.personality) {
    const personalityEmbedding = embeddingFromTagWeights(
      multipliers.personality,
      MULTIPLIER_CONTEXT_WEIGHT_PERSONALITY,
    );
    if (!isZeroEmbedding(personalityEmbedding)) {
      components.push({ vector: personalityEmbedding, weight: 1 });
    }
  }
  if (multipliers.demand) {
    const demandEmbedding = embeddingFromTagWeights(multipliers.demand, MULTIPLIER_CONTEXT_WEIGHT_DEMAND);
    if (!isZeroEmbedding(demandEmbedding)) {
      components.push({ vector: demandEmbedding, weight: 1 });
    }
  }
  if (multipliers.relationship) {
    const relationshipEmbedding = embeddingFromTagWeights(
      multipliers.relationship,
      MULTIPLIER_CONTEXT_WEIGHT_RELATIONSHIP,
    );
    if (!isZeroEmbedding(relationshipEmbedding)) {
      const relationshipWeight =
        unhousedPressure > 0 ? Math.max(0.6, 1 - unhousedPressure * 0.25) : 1;
      components.push({ vector: relationshipEmbedding, weight: relationshipWeight });
    }
  }

  if (components.length === 0) {
    return createZeroEmbedding();
  }

  const aggregate = createZeroEmbedding();
  let totalWeight = 0;
  for (const { vector, weight } of components) {
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    addScaledEmbedding(aggregate, vector, weight);
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return createZeroEmbedding();
  }

  scaleEmbedding(aggregate, 1 / totalWeight);
  return normalizeEmbedding(aggregate);
}

function updateContextEmbedding(
  state: BrainState,
  brain: BrainGraphRuntime,
  multipliers: BrainMultiplierSet,
  currentNodeMetadata?: BrainNodeMetadata,
): void {
  const base = cloneEmbedding(state.contextEmbedding);
  if (!isZeroEmbedding(base)) {
    scaleEmbedding(base, CONTEXT_DECAY);
  }

  if (!isZeroEmbedding(state.pendingContextEmbedding)) {
    addScaledEmbedding(base, state.pendingContextEmbedding, PULSE_CONTEXT_WEIGHT);
  }

  const multiplierEmbedding = buildMultiplierEmbedding(multipliers);
  if (!isZeroEmbedding(multiplierEmbedding)) {
    addScaledEmbedding(base, multiplierEmbedding, 1);
  }

  const currentNode = currentNodeMetadata ?? requireNode(brain, state.currentNodeId);
  if (currentNode?.embedding && !isZeroEmbedding(currentNode.embedding)) {
    addScaledEmbedding(base, currentNode.embedding, CURRENT_NODE_CONTEXT_WEIGHT);
  }

  let next = base;
  if (isZeroEmbedding(next)) {
    if (!isZeroEmbedding(multiplierEmbedding)) {
      next = cloneEmbedding(multiplierEmbedding);
    } else if (currentNode?.embedding && !isZeroEmbedding(currentNode.embedding)) {
      next = cloneEmbedding(currentNode.embedding);
    } else if (!isZeroEmbedding(state.pendingContextEmbedding)) {
      next = cloneEmbedding(state.pendingContextEmbedding);
    }
  }

  state.contextEmbedding = isZeroEmbedding(next) ? createZeroEmbedding() : normalizeEmbedding(next);
  state.pendingContextEmbedding = createZeroEmbedding();
}

export function refreshBrainContext(
  state: BrainState,
  multipliers: BrainMultiplierSet = {},
  moodLevels: Record<string, number> = {},
): void {
  const brain = requireBrain(state.brainId);
  const effectiveMultipliers = createEffectiveMultipliers(state.brainId, multipliers, moodLevels);
  updateContextEmbedding(state, brain, effectiveMultipliers);
}

export function previewBrainCandidates(
  state: BrainState,
  multipliers: BrainMultiplierSet = {},
  moodLevels: Record<string, number> = {},
): BrainDecisionFactor[] {
  const brain = requireBrain(state.brainId);
  const effectiveMultipliers = createEffectiveMultipliers(state.brainId, multipliers, moodLevels);
  updateContextEmbedding(state, brain, effectiveMultipliers);
  return evaluateCandidates(brain, state, state.currentNodeId, effectiveMultipliers);
}

export function createBrainState(brainId: string, seed?: BrainMigrationSeed): BrainState {
  const brain = requireBrain(brainId);
  const startNode = requireNode(brain, brain.startNodeId);
  const state: BrainState = {
    brainId,
    currentNodeId: startNode.id,
    nodeTimer: startNode.duration,
    lastDecision: null,
    traitFlags: [],
    activeJumpEdges: new Map(),
    dynamicEdgesFrom: new Map(),
    jumpEdgeCooldowns: {},
    plasticity: createPlasticityState(),
    pendingPulses: [],
    nodeCharge: new Map<string, NodeChargeState>(),
    recentCharge: new Map<string, RecentNodeChargeState>(),
    recentAssociations: new Map<string, RecentAssociationState>(),
    pulseEvents: [],
    nextPulseId: 1,
    contextEmbedding: createZeroEmbedding(),
    pendingContextEmbedding: createZeroEmbedding(),
  };
  if (seed) {
    migrateBrainStateFromSeed(state, brain, startNode, seed);
  }
  return state;
}

function migrateBrainStateFromSeed(
  state: BrainState,
  targetBrain: BrainGraphRuntime,
  startNode: BrainNodeMetadata,
  seed: BrainMigrationSeed,
): void {
  if (Array.isArray(seed.contextEmbedding) && seed.contextEmbedding.length > 0) {
    const normalized = normalizeEmbedding(coerceEmbedding(seed.contextEmbedding));
    if (!isZeroEmbedding(normalized)) {
      state.contextEmbedding = normalized;
    }
  }

  const durationScale = computeDurationScale(seed.sourceActiveNodeDuration, startNode.duration);
  const scaledTick = scaleTimer(seed.plasticityTick, durationScale);
  state.plasticity.tick = scaledTick;

  const sourceBrain = seed.sourceBrainId ? BRAIN_LIBRARY[seed.sourceBrainId] : null;
  if (!sourceBrain) {
    return;
  }

  const nodeMapping = buildMigrationNodeMapping(sourceBrain, targetBrain);
  applyPlasticitySeed(state, seed, nodeMapping, durationScale, targetBrain.startNodeId);
  applyAssociationSeed(state, seed, nodeMapping, durationScale, targetBrain.startNodeId);
}

type MigrationNodeMapping = Map<string, string>;

function buildMigrationNodeMapping(
  sourceBrain: BrainGraphRuntime,
  targetBrain: BrainGraphRuntime,
): MigrationNodeMapping {
  const mapping: MigrationNodeMapping = new Map();
  const targetIds = Array.from(targetBrain.nodes.keys()).sort();
  const fallbackId = targetBrain.startNodeId;

  for (const sourceId of sourceBrain.nodes.keys()) {
    if (targetBrain.nodes.has(sourceId)) {
      mapping.set(sourceId, sourceId);
    }
  }

  const sourceIds = Array.from(sourceBrain.nodes.keys()).sort();
  for (const sourceId of sourceIds) {
    if (mapping.has(sourceId)) {
      continue;
    }
    const sourceNode = sourceBrain.nodes.get(sourceId);
    if (!sourceNode) {
      continue;
    }
    let bestTargetId: string | null = null;
    let bestScore = -Infinity;
    for (const targetId of targetIds) {
      const targetNode = targetBrain.nodes.get(targetId);
      if (!targetNode) {
        continue;
      }
      const score = scoreNodeSimilarity(sourceNode, targetNode);
      if (score > bestScore || (score === bestScore && targetId < (bestTargetId ?? targetId))) {
        bestScore = score;
        bestTargetId = targetId;
      }
    }
    mapping.set(sourceId, bestTargetId ?? fallbackId);
  }

  return mapping;
}

function scoreNodeSimilarity(a: BrainNodeMetadata, b: BrainNodeMetadata): number {
  let overlap = 0;
  const tagSet = new Set(a.tags);
  for (const tag of b.tags) {
    if (tagSet.has(tag)) {
      overlap += 1;
    }
  }
  const frequencyAffinity = 1 / (1 + Math.abs(a.baseFrequency - b.baseFrequency));
  return overlap > 0 ? overlap * 10 + frequencyAffinity : frequencyAffinity;
}

function applyPlasticitySeed(
  state: BrainState,
  seed: BrainMigrationSeed,
  mapping: MigrationNodeMapping,
  durationScale: number,
  fallbackNodeId: string,
): void {
  if (!Array.isArray(seed.plasticityEdges)) {
    return;
  }

  for (const entry of seed.plasticityEdges) {
    if (!entry || !entry.sourceId || !entry.targetId) {
      continue;
    }
    const mappedSource = mapping.get(entry.sourceId) ?? fallbackNodeId;
    const mappedTarget = mapping.get(entry.targetId) ?? fallbackNodeId;
    if (!mappedSource || !mappedTarget) {
      continue;
    }

    const adjustment = clampToUnit(entry.state.adjustment);
    if (Math.abs(adjustment) < 1e-6) {
      continue;
    }

    let targetMap = state.plasticity.edges.get(mappedSource);
    if (!targetMap) {
      targetMap = new Map();
      state.plasticity.edges.set(mappedSource, targetMap);
    }

    const scaledUsage = Math.max(1, Math.round(entry.state.usageCount ?? 1));
    const relativeDecay = entry.state.nextDecayTick - seed.plasticityTick;
    const scaledDecayOffset = scaleTimer(relativeDecay, durationScale);
    const nextDecayTick = state.plasticity.tick + scaledDecayOffset;

    const existing = targetMap.get(mappedTarget);
    if (existing) {
      existing.adjustment = clampToUnit(existing.adjustment + adjustment);
      existing.usageCount = Math.max(existing.usageCount, scaledUsage);
      existing.nextDecayTick = Math.max(existing.nextDecayTick, nextDecayTick);
    } else {
      targetMap.set(mappedTarget, {
        adjustment,
        usageCount: scaledUsage,
        nextDecayTick: Math.max(0, nextDecayTick),
      });
    }
  }

  for (const [sourceId, targetMap] of state.plasticity.edges.entries()) {
    for (const [targetId, edge] of targetMap.entries()) {
      if (!Number.isFinite(edge.adjustment) || Math.abs(edge.adjustment) < 1e-6) {
        targetMap.delete(targetId);
      }
    }
    if (targetMap.size === 0) {
      state.plasticity.edges.delete(sourceId);
    }
  }
}

function applyAssociationSeed(
  state: BrainState,
  seed: BrainMigrationSeed,
  mapping: MigrationNodeMapping,
  durationScale: number,
  fallbackNodeId: string,
): void {
  if (!Array.isArray(seed.recentAssociations)) {
    return;
  }

  for (const association of seed.recentAssociations) {
    if (!association || !association.sourceId || !association.targetId) {
      continue;
    }
    const mappedSource = mapping.get(association.sourceId) ?? fallbackNodeId;
    const mappedTarget = mapping.get(association.targetId) ?? fallbackNodeId;
    if (!mappedSource || !mappedTarget) {
      continue;
    }

    const ttl = Math.max(1, Math.min(RECENT_ASSOCIATION_TTL, scaleTimer(association.ttl, durationScale)));
    const weight = clampAssociationWeight(association.weight);
    const decay = clampAssociationDecay(association.decay);
    const key = makeEdgeKey(mappedSource, mappedTarget);
    const existing = state.recentAssociations.get(key);
    if (existing) {
      existing.weight = Math.max(existing.weight, weight);
      existing.ttl = Math.max(existing.ttl, ttl);
      existing.decay = Math.min(existing.decay, decay);
    } else {
      state.recentAssociations.set(key, {
        sourceId: mappedSource,
        targetId: mappedTarget,
        weight,
        ttl,
        decay,
      });
    }
  }
}

function computeDurationScale(sourceDuration: number | undefined, targetDuration: number): number {
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
    return 1;
  }
  if (!Number.isFinite(sourceDuration) || (sourceDuration ?? 0) <= 0) {
    return 1;
  }
  const ratio = targetDuration / (sourceDuration ?? targetDuration);
  return ratio > 0 ? ratio : 1;
}

function scaleTimer(value: number, scale: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = Math.round(value * (Number.isFinite(scale) && scale > 0 ? scale : 1));
  return scaled >= 0 ? scaled : 0;
}

function clampToUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  if (value < -1) {
    return -1;
  }
  return value;
}

function clampAssociationWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return RECENT_ASSOCIATION_MIN_WEIGHT;
  }
  const clamped = Math.max(RECENT_ASSOCIATION_MIN_WEIGHT, Math.min(RECENT_ASSOCIATION_MAX_WEIGHT, value));
  return clamped;
}

function clampAssociationDecay(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    return RECENT_ASSOCIATION_DECAY;
  }
  return value;
}

export function serializeBrainState(state: BrainState): SerializedBrainState {
  const activeJumpEdges: SerializedActiveJumpEdgeState[] = [];
  for (const [id, edge] of state.activeJumpEdges.entries()) {
    activeJumpEdges.push({
      id,
      sourceNodeIds: [...edge.sourceNodeIds],
      targetNodeId: edge.targetNodeId,
      weight: edge.weight,
    });
  }

  const dynamicEdgesFrom: SerializedDynamicEdgeEntry[] = [];
  for (const [sourceId, edges] of state.dynamicEdgesFrom.entries()) {
    dynamicEdgesFrom.push({
      sourceId,
      targets: edges.map((edge) => ({ targetId: edge.targetId, weight: edge.weight })),
    });
  }

  const plasticityEdges: Record<string, Record<string, SerializedPlasticityEdgeState>> = {};
  for (const [sourceId, targetMap] of state.plasticity.edges.entries()) {
    const serializedTargets: Record<string, SerializedPlasticityEdgeState> = {};
    for (const [targetId, edgeState] of targetMap.entries()) {
      serializedTargets[targetId] = { ...edgeState };
    }
    plasticityEdges[sourceId] = serializedTargets;
  }

  const nodeCharge: Record<string, SerializedNodeChargeState> = {};
  for (const [nodeId, charge] of state.nodeCharge.entries()) {
    nodeCharge[nodeId] = {
      value: charge.value,
      capacity: charge.capacity,
    };
  }

  const recentCharge: Record<string, SerializedRecentNodeChargeState> = {};
  for (const [nodeId, charge] of state.recentCharge.entries()) {
    recentCharge[nodeId] = {
      value: charge.value,
      capacity: charge.capacity,
      ttl: charge.ttl,
    };
  }

  const recentAssociations: SerializedRecentAssociationState[] = [];
  for (const association of state.recentAssociations.values()) {
    recentAssociations.push({
      sourceId: association.sourceId,
      targetId: association.targetId,
      weight: association.weight,
      ttl: association.ttl,
      decay: association.decay,
    });
  }

  return {
    brainId: state.brainId,
    currentNodeId: state.currentNodeId,
    nodeTimer: state.nodeTimer,
    lastDecision: cloneBrainDecision(state.lastDecision),
    traitFlags: [...state.traitFlags],
    activeJumpEdges,
    dynamicEdgesFrom,
    jumpEdgeCooldowns: { ...state.jumpEdgeCooldowns },
    plasticity: {
      tick: state.plasticity.tick,
      edges: plasticityEdges,
    },
    pendingPulses: state.pendingPulses.map((pulse) => ({
      id: pulse.id,
      edgeKey: pulse.edgeKey,
      sourceNodeId: pulse.sourceNodeId,
      targetNodeId: pulse.targetNodeId,
      startedTick: pulse.startedTick,
      travelDuration: pulse.travelDuration,
      elapsed: pulse.elapsed,
      strength: pulse.strength,
      payload: pulse.payload,
      payloadRate: pulse.payloadRate,
      appearance: clonePulseAppearance(pulse.appearance),
    })),
    nodeCharge,
    recentCharge,
    recentAssociations,
    pulseEvents: state.pulseEvents.map((event) => ({
      id: event.id,
      edgeKey: event.edgeKey,
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      startedTick: event.startedTick,
      travelDuration: event.travelDuration,
      strength: event.strength,
      payload: event.payload,
      payloadRate: event.payloadRate,
      appearance: clonePulseAppearance(event.appearance),
    })),
    nextPulseId: state.nextPulseId,
    contextEmbedding: cloneEmbedding(state.contextEmbedding),
    pendingContextEmbedding: cloneEmbedding(state.pendingContextEmbedding),
  } satisfies SerializedBrainState;
}

export function restoreBrainState(serialized: SerializedBrainState): BrainState {
  const base = createBrainState(serialized.brainId);
  base.currentNodeId = serialized.currentNodeId;
  base.nodeTimer = serialized.nodeTimer;
  base.lastDecision = cloneBrainDecision(serialized.lastDecision);
  base.traitFlags = [...(serialized.traitFlags ?? [])];

  base.activeJumpEdges = new Map();
  for (const edge of serialized.activeJumpEdges ?? []) {
    base.activeJumpEdges.set(edge.id, {
      id: edge.id,
      sourceNodeIds: [...edge.sourceNodeIds],
      targetNodeId: edge.targetNodeId,
      weight: edge.weight,
    });
  }

  base.dynamicEdgesFrom = new Map();
  for (const entry of serialized.dynamicEdgesFrom ?? []) {
    base.dynamicEdgesFrom.set(
      entry.sourceId,
      entry.targets.map((target) => ({ targetId: target.targetId, weight: target.weight })),
    );
  }

  base.jumpEdgeCooldowns = { ...(serialized.jumpEdgeCooldowns ?? {}) };
  base.plasticity = restorePlasticityState(serialized.plasticity);
  base.pendingPulses = (serialized.pendingPulses ?? []).map((pulse) => {
    const travelDuration = Math.max(1, Math.round(pulse.travelDuration ?? 1));
    const elapsed = Math.max(0, Math.min(travelDuration, Math.round(pulse.elapsed ?? 0)));
    const payload = Number.isFinite(pulse.payload) ? pulse.payload : pulse.strength ?? 0;
    const normalizedPayload = Number.isFinite(payload) ? payload : 0;
    const payloadRate = Number.isFinite(pulse.payloadRate)
      ? pulse.payloadRate
      : travelDuration > 0
        ? normalizedPayload / travelDuration
        : normalizedPayload;
    const strength = Number.isFinite(pulse.strength) ? pulse.strength : clamp01(normalizedPayload);
    return {
      id: pulse.id,
      edgeKey: pulse.edgeKey,
      sourceNodeId: pulse.sourceNodeId,
      targetNodeId: pulse.targetNodeId,
      startedTick: pulse.startedTick,
      travelDuration,
      elapsed,
      strength,
      payload: normalizedPayload,
      payloadRate,
      appearance: clonePulseAppearance(pulse.appearance),
    } satisfies BrainPulse;
  });
  base.nodeCharge = new Map();
  for (const [nodeId, charge] of Object.entries(serialized.nodeCharge ?? {})) {
    const value = Number(charge?.value ?? 0);
    const capacity = Number(charge?.capacity ?? DEFAULT_CHARGE_CAPACITY);
    if (value > MIN_CHARGE_VALUE) {
      base.nodeCharge.set(nodeId, {
        value,
        capacity: capacity > MIN_CHARGE_VALUE ? capacity : DEFAULT_CHARGE_CAPACITY,
      });
    }
  }
  base.recentCharge = new Map();
  for (const [nodeId, charge] of Object.entries(serialized.recentCharge ?? {})) {
    const value = Number(charge?.value ?? 0);
    const capacity = Number(charge?.capacity ?? DEFAULT_CHARGE_CAPACITY);
    const ttl = Number.isFinite(charge?.ttl) ? Math.max(0, Math.round(charge!.ttl)) : 0;
    if (value > MIN_CHARGE_VALUE && ttl > 0) {
      base.recentCharge.set(nodeId, {
        value,
        capacity: capacity > MIN_CHARGE_VALUE ? capacity : DEFAULT_CHARGE_CAPACITY,
        ttl,
      });
    }
  }
  base.recentAssociations = new Map();
  for (const entry of serialized.recentAssociations ?? []) {
    if (!entry) {
      continue;
    }
    const sourceId = entry.sourceId;
    const targetId = entry.targetId;
    if (!sourceId || !targetId) {
      continue;
    }
    const weight = Number(entry.weight);
    const ttl = Number.isFinite(entry.ttl) ? Math.max(0, Math.round(entry.ttl)) : 0;
    const decay = Number.isFinite(entry.decay) && entry.decay > 0 && entry.decay < 1 ? entry.decay : RECENT_ASSOCIATION_DECAY;
    if (weight <= MIN_CHARGE_VALUE || ttl <= 0) {
      continue;
    }
    const key = makeEdgeKey(sourceId, targetId);
    base.recentAssociations.set(key, {
      sourceId,
      targetId,
      weight,
      ttl,
      decay,
    });
  }
  base.pulseEvents = (serialized.pulseEvents ?? []).map((event) => {
    const travelDuration = Math.max(1, Math.round(event.travelDuration ?? 1));
    const payload = Number.isFinite(event.payload) ? event.payload : event.strength ?? 0;
    const normalizedPayload = Number.isFinite(payload) ? payload : 0;
    const payloadRate = Number.isFinite(event.payloadRate)
      ? event.payloadRate
      : travelDuration > 0
        ? normalizedPayload / travelDuration
        : normalizedPayload;
    const strength = Number.isFinite(event.strength) ? event.strength : clamp01(normalizedPayload);
    return {
      id: event.id,
      edgeKey: event.edgeKey,
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      startedTick: event.startedTick,
      travelDuration,
      strength,
      payload: normalizedPayload,
      payloadRate,
      appearance: clonePulseAppearance(event.appearance),
    } satisfies BrainPulseEvent;
  });
  base.nextPulseId = typeof serialized.nextPulseId === 'number' ? serialized.nextPulseId : 1;
  base.contextEmbedding = coerceEmbedding(serialized.contextEmbedding);
  base.pendingContextEmbedding = coerceEmbedding(serialized.pendingContextEmbedding);
  return base;
}

export function resetNodeTimer(state: BrainState, newNodeId?: string): number {
  const brain = requireBrain(state.brainId);
  if (newNodeId) {
    state.currentNodeId = newNodeId;
  }
  const node = requireNode(brain, state.currentNodeId);
  state.nodeTimer = node.duration;
  return state.nodeTimer;
}

export function getNodeMetadata(brainId: string, nodeId: string): BrainNodeMetadata {
  const brain = requireBrain(brainId);
  return requireNode(brain, nodeId);
}

export function getCurrentNodeMetadata(state: BrainState): BrainNodeMetadata {
  return getNodeMetadata(state.brainId, state.currentNodeId);
}

export interface BrainTickResult {
  state: BrainState;
  nodeDuration: number;
  decision: BrainDecision | null;
}

export interface BrainTickContext {
  rng?: RngStream | null;
  tick?: number;
  pulsePalette?: BrainPulsePalette | null;
}

export function tickBrain(
  state: BrainState,
  multipliers: BrainMultiplierSet = {},
  moodLevels: Record<string, number> = {},
  context: BrainTickContext = {},
): BrainTickResult {
  const brain = requireBrain(state.brainId);
  advancePlasticityState(state.plasticity);
  updateJumpEdges(state, brain, multipliers, moodLevels);
  refreshDynamicEdgeCache(state);
  let decision: BrainDecision | null = null;
  const metadata = requireNode(brain, state.currentNodeId);
  const effectiveMultipliers = createEffectiveMultipliers(state.brainId, multipliers, moodLevels);
  updateContextEmbedding(state, brain, effectiveMultipliers, metadata);
  const candidates = evaluateCandidates(brain, state, state.currentNodeId, effectiveMultipliers);

  if (candidates.length === 0) {
    if (state.nodeTimer > 0) {
      state.nodeTimer = Math.max(0, state.nodeTimer - 1);
    } else {
      resetNodeTimer(state, state.currentNodeId);
      decision = {
        fromNodeId: state.currentNodeId,
        candidates: [],
        chosenNodeId: state.currentNodeId,
      };
      state.lastDecision = decision;
    }
    return {
      state,
      nodeDuration: metadata.duration,
      decision: decision ?? state.lastDecision,
    };
  }

  distributePulseBudget(state, candidates, metadata, context);
  const deposits = advancePendingPulses(state, brain);
  applyNodeChargeDecay(state, brain);
  decayRecentChargeCache(state);
  decayRecentAssociations(state);
  refreshDynamicEdgeCache(state);
  for (const [targetId, strength] of deposits.entries()) {
    if (strength <= 0) {
      continue;
    }
    const targetMetadata = brain.nodes.get(targetId);
    const capacity = getNodeChargeCapacity(targetMetadata);
    const existing = state.nodeCharge.get(targetId)?.value ?? 0;
    const nextValue = Math.min(capacity, existing + strength);
    setNodeChargeState(state, targetId, nextValue, capacity);
  }

  if (state.nodeTimer > 0) {
    state.nodeTimer = Math.max(0, state.nodeTimer - 1);
  }

  if (state.nodeTimer <= 0) {
    const bestCandidate = candidates[0];
    if (bestCandidate && bestCandidate.desirability > 0) {
      const targetMetadata = brain.nodes.get(bestCandidate.nodeId);
      const threshold = getNodeChargeCapacity(targetMetadata);
      const currentCharge = state.nodeCharge.get(bestCandidate.nodeId)?.value ?? 0;
      if (currentCharge < threshold) {
        setNodeChargeState(state, bestCandidate.nodeId, threshold, threshold);
      }
    }
  }

  const readyTarget = resolveReadyTarget(state, brain, candidates);
  if (readyTarget) {
    const fromNodeId = state.currentNodeId;
    const nextNodeId = readyTarget.nodeId;
    decision = {
      fromNodeId,
      candidates,
      chosenNodeId: nextNodeId,
    };
    registerPlasticityOutcome(state.plasticity, fromNodeId, nextNodeId, 1);
    state.lastDecision = decision;
    commitBrainTransition(state, nextNodeId);
    refreshDynamicEdgeCache(state);
  } else {
    const bestCandidate = candidates[0];
    if (bestCandidate) {
      const fromNodeId = state.currentNodeId;
      const gateMultiplier = Math.min(bestCandidate.moodMultiplier, bestCandidate.demandMultiplier);
      const timerExpired = state.nodeTimer <= 0;
      const suppressedByMultipliers = gateMultiplier < LOW_MULTIPLIER_FAILURE_THRESHOLD;
      if (timerExpired || suppressedByMultipliers) {
        const penalty = Math.min(
          1,
          Math.max(timerExpired ? 1 : 0, suppressedByMultipliers ? 1 - gateMultiplier : 0),
        );
        if (penalty > 0) {
          registerPlasticityOutcome(state.plasticity, fromNodeId, bestCandidate.nodeId, -penalty);
        }
      }
    }
  }

  return {
    state,
    nodeDuration: metadata.duration,
    decision: decision ?? state.lastDecision,
  };
}

export function cloneBrainDecision(decision: BrainDecision | null): BrainDecision | null {
  if (!decision) {
    return null;
  }
  return {
    fromNodeId: decision.fromNodeId,
    chosenNodeId: decision.chosenNodeId,
    candidates: decision.candidates.map((candidate) => ({
      nodeId: candidate.nodeId,
      desirability: candidate.desirability,
      edgeWeight: candidate.edgeWeight,
      baseWeight: candidate.baseWeight,
      plasticityAdjustment: candidate.plasticityAdjustment,
      baseFrequency: candidate.baseFrequency,
      moodMultiplier: candidate.moodMultiplier,
      personalityMultiplier: candidate.personalityMultiplier,
      demandMultiplier: candidate.demandMultiplier,
      totalMultiplier: candidate.totalMultiplier,
      attentionScore: candidate.attentionScore,
      embedding: cloneEmbedding(candidate.embedding),
      tags: [...candidate.tags],
    })),
  } satisfies BrainDecision;
}

function accumulateContextContribution(
  state: BrainState,
  candidate: BrainDecisionFactor,
  payload: number,
): void {
  if (!Number.isFinite(payload) || payload <= MIN_CHARGE_VALUE) {
    return;
  }
  if (!candidate.embedding || candidate.embedding.length === 0) {
    return;
  }
  if (!Array.isArray(state.pendingContextEmbedding) || state.pendingContextEmbedding.length === 0) {
    state.pendingContextEmbedding = createZeroEmbedding();
  }
  addScaledEmbedding(state.pendingContextEmbedding, candidate.embedding, payload);
}

function distributePulseBudget(
  state: BrainState,
  candidates: BrainDecisionFactor[],
  metadata: BrainNodeMetadata,
  context: BrainTickContext,
): void {
  const duration = Math.max(1, metadata.duration);
  const budgetScale = getPulseBudgetScale(metadata);
  const baseBudget = (1 / duration) * budgetScale;
  const totalDesirability = candidates.reduce((sum, candidate) => {
    return candidate.desirability > 0 ? sum + candidate.desirability : sum;
  }, 0);
  if (totalDesirability <= 0 || baseBudget <= 0) {
    return;
  }

  prunePulseEvents(state, context.tick);

  const rng = context.rng ?? null;
  const jitterRange = PULSE_JITTER_RANGE;
  const currentTick = typeof context.tick === 'number' ? context.tick : 0;
  const palette = context.pulsePalette ?? DEFAULT_PULSE_PALETTE;

  const provisionalBudgets: number[] = [];
  for (const candidate of candidates) {
    if (candidate.desirability <= 0) {
      provisionalBudgets.push(0);
      continue;
    }
    const share = candidate.desirability / totalDesirability;
    const jitter = rng ? (rng.nextFloat() * 2 - 1) * jitterRange : 0;
    const allocation = Math.max(0, baseBudget * share * (1 + jitter));
    provisionalBudgets.push(allocation);
  }

  const provisionalTotal = provisionalBudgets.reduce((sum, value) => sum + value, 0);
  const normalization = provisionalTotal > 0 ? baseBudget / provisionalTotal : 0;
  const normalizedBudgets = provisionalBudgets.map((value) => value * normalization);

  const desirabilityDenominator = totalDesirability > 0 ? totalDesirability : 1;

  const resolvePulseCount = (allocation: number, share: number): number => {
    const safeAllocation = allocation > 0 ? allocation : 0;
    const normalizedShare = clamp01(share);
    const durationFactor = clamp(metadata.duration / 6, 0.5, 2.5);
    const scaleFactor = clamp(metadata.pulseBudgetScale ?? 1, 0.35, 3);
    let count = Math.round(
      1 +
        normalizedShare * (PULSE_MAX_SPLITS_PER_EDGE - 1) * 0.9 +
        (durationFactor - 1) * 1.2 +
        (scaleFactor - 1) * 0.8,
    );
    count = clamp(count, 1, PULSE_MAX_SPLITS_PER_EDGE);
    const maxByMinPayload = Math.max(
      1,
      Math.min(PULSE_MAX_SPLITS_PER_EDGE, Math.floor(safeAllocation / PULSE_MIN_PAYLOAD)),
    );
    if (count > maxByMinPayload) {
      count = maxByMinPayload;
    }
    const targetByPayload = Math.max(
      1,
      Math.min(PULSE_MAX_SPLITS_PER_EDGE, Math.round(safeAllocation / PULSE_TARGET_PAYLOAD)),
    );
    if (count < targetByPayload) {
      count = Math.min(maxByMinPayload, targetByPayload);
    }
    return clamp(count, 1, PULSE_MAX_SPLITS_PER_EDGE);
  };

  const createPayloadWeights = (count: number): number[] => {
    if (count <= 1) {
      return [1];
    }
    const weights: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const jitter = rng ? (rng.nextFloat() * 2 - 1) * PULSE_PAYLOAD_JITTER_RANGE : 0;
      const weight = Math.max(0.1, 1 + jitter);
      weights.push(weight);
    }
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      return Array(count).fill(1 / count);
    }
    return weights.map((value) => value / total);
  };

  const resolveTravelDuration = (weightShare: number, desirabilityShare: number): number => {
    const normalizedWeight = clamp01(weightShare);
    const normalizedDesire = clamp01(desirabilityShare);
    const scaleFactor = clamp(metadata.pulseBudgetScale ?? 1, 0.2, 3);
    const durationFactor = clamp(metadata.duration / 6, 0.4, 2.8);
    const base = Math.max(
      1,
      Math.round(
        duration *
          (PULSE_TRAVEL_BASE_RATIO +
            (1 - normalizedDesire) * PULSE_TRAVEL_VARIANCE +
            (scaleFactor - 1) * 0.18 +
            (durationFactor - 1) * 0.12),
      ),
    );
    const payloadBias = 1 + normalizedWeight * PULSE_TRAVEL_PAYLOAD_BIAS;
    const jitter = rng ? 1 + (rng.nextFloat() * 2 - 1) * PULSE_TRAVEL_DURATION_JITTER : 1;
    const maxDuration = Math.max(1, Math.round(duration * PULSE_TRAVEL_MAX_RATIO));
    return clamp(Math.round(base * payloadBias * jitter), 1, maxDuration);
  };

  const nextPending: BrainPulse[] = [];
  const nextEvents: BrainPulseEvent[] = [];

  let index = 0;
  for (const candidate of candidates) {
    const allocation = normalizedBudgets[index];
    index += 1;
    if (!allocation || allocation <= MIN_CHARGE_VALUE) {
      continue;
    }
    const desirabilityShare = candidate.desirability > 0 ? candidate.desirability / desirabilityDenominator : 0;
    const pulseCount = resolvePulseCount(allocation, desirabilityShare);
    const weights = createPayloadWeights(pulseCount);
    let remaining = allocation;
    const pendingBefore = nextPending.length;
    let lastLocalPulseIndex = -1;
    let lastLocalEventIndex = -1;
    let contextPayload = 0;

    for (let i = 0; i < pulseCount; i += 1) {
      const isLast = i === pulseCount - 1;
      const weightShare = weights[i] ?? 0;
      const expected = allocation * weightShare;
      const candidatePayload = isLast ? remaining : Math.min(remaining, expected);
      if (candidatePayload <= MIN_CHARGE_VALUE && !isLast) {
        continue;
      }
      if (candidatePayload <= MIN_CHARGE_VALUE && isLast) {
        if (lastLocalPulseIndex >= pendingBefore && remaining > MIN_CHARGE_VALUE) {
          const tailPulse = nextPending[lastLocalPulseIndex];
          const tailEvent = nextEvents[lastLocalEventIndex];
          tailPulse.payload += remaining;
          tailPulse.payloadRate = tailPulse.travelDuration > 0 ? tailPulse.payload / tailPulse.travelDuration : tailPulse.payload;
          tailPulse.strength = clamp01(tailPulse.payload / PULSE_VISUAL_REFERENCE_PAYLOAD);
          const updatedAppearance = resolvePulseAppearance(candidate.tags ?? [], tailPulse.strength, palette);
          tailPulse.appearance = clonePulseAppearance(updatedAppearance);
          if (tailEvent) {
            tailEvent.payload = tailPulse.payload;
            tailEvent.payloadRate = tailPulse.payloadRate;
            tailEvent.strength = tailPulse.strength;
            tailEvent.appearance = clonePulseAppearance(updatedAppearance);
          }
          remaining = 0;
        }
        remaining = 0;
        continue;
      }
      const payload = candidatePayload;
      remaining = Math.max(0, remaining - payload);
      contextPayload += Math.max(0, payload);
      const weightRatio = allocation > 0 ? payload / allocation : 0;
      const travelDuration = resolveTravelDuration(weightRatio, desirabilityShare);
      const payloadRate = travelDuration > 0 ? payload / travelDuration : payload;
      const visualStrength = clamp01(payload / PULSE_VISUAL_REFERENCE_PAYLOAD);
      const appearance = resolvePulseAppearance(candidate.tags ?? [], visualStrength, palette);
      const pulseId = `pulse-${state.nextPulseId}`;
      state.nextPulseId += 1;
      const edgeKey = makeEdgeKey(state.currentNodeId, candidate.nodeId);
      const pulse: BrainPulse = {
        id: pulseId,
        edgeKey,
        sourceNodeId: state.currentNodeId,
        targetNodeId: candidate.nodeId,
        startedTick: currentTick,
        travelDuration,
        elapsed: 0,
        strength: visualStrength,
        payload,
        payloadRate,
        appearance: clonePulseAppearance(appearance),
      };
      nextPending.push(pulse);
      nextEvents.push({
        id: pulseId,
        edgeKey,
        sourceNodeId: pulse.sourceNodeId,
        targetNodeId: pulse.targetNodeId,
        startedTick: currentTick,
        travelDuration,
        strength: visualStrength,
        payload,
        payloadRate,
        appearance: clonePulseAppearance(appearance),
      });
      lastLocalPulseIndex = nextPending.length - 1;
      lastLocalEventIndex = nextEvents.length - 1;
    }

    if (nextPending.length === pendingBefore && allocation > MIN_CHARGE_VALUE) {
      const fallbackDuration = resolveTravelDuration(1, desirabilityShare);
      const payloadRate = fallbackDuration > 0 ? allocation / fallbackDuration : allocation;
      const visualStrength = clamp01(allocation / PULSE_VISUAL_REFERENCE_PAYLOAD);
      const appearance = resolvePulseAppearance(candidate.tags ?? [], visualStrength, palette);
      const pulseId = `pulse-${state.nextPulseId}`;
      state.nextPulseId += 1;
      const edgeKey = makeEdgeKey(state.currentNodeId, candidate.nodeId);
      const pulse: BrainPulse = {
        id: pulseId,
        edgeKey,
        sourceNodeId: state.currentNodeId,
        targetNodeId: candidate.nodeId,
        startedTick: currentTick,
        travelDuration: fallbackDuration,
        elapsed: 0,
        strength: visualStrength,
        payload: allocation,
        payloadRate,
        appearance: clonePulseAppearance(appearance),
      };
      nextPending.push(pulse);
      nextEvents.push({
        id: pulseId,
        edgeKey,
        sourceNodeId: pulse.sourceNodeId,
        targetNodeId: pulse.targetNodeId,
        startedTick: currentTick,
        travelDuration: fallbackDuration,
        strength: visualStrength,
        payload: allocation,
        payloadRate,
        appearance: clonePulseAppearance(appearance),
      });
      contextPayload += Math.max(0, allocation);
    }

    if (contextPayload > MIN_CHARGE_VALUE) {
      accumulateContextContribution(state, candidate, contextPayload);
    }
  }

  if (nextPending.length > 0) {
    state.pendingPulses.push(...nextPending);
  }
  if (nextEvents.length > 0) {
    state.pulseEvents.push(...nextEvents);
  }
}

function advancePendingPulses(state: BrainState, brain: BrainGraphRuntime): Map<string, number> {
  if (state.pendingPulses.length === 0) {
    return new Map();
  }
  const deposits = new Map<string, number>();
  const remaining: BrainPulse[] = [];
  for (const pulse of state.pendingPulses) {
    pulse.elapsed += 1;
    if (pulse.elapsed >= pulse.travelDuration) {
      const targetMetadata = brain.nodes.get(pulse.targetNodeId);
      const capacity = getNodeChargeCapacity(targetMetadata);
      const existingCharge = state.nodeCharge.get(pulse.targetNodeId)?.value ?? 0;
      const pendingCharge = deposits.get(pulse.targetNodeId) ?? 0;
      const availableCapacity = Math.max(0, capacity - existingCharge - pendingCharge);
      if (availableCapacity > MIN_CHARGE_VALUE) {
        const applied = Math.min(pulse.payload, availableCapacity);
        const existing = deposits.get(pulse.targetNodeId) ?? 0;
        deposits.set(pulse.targetNodeId, existing + applied);
      }
    } else {
      remaining.push(pulse);
    }
  }
  state.pendingPulses = remaining;
  return deposits;
}

function applyNodeChargeDecay(state: BrainState, brain: BrainGraphRuntime): void {
  if (state.nodeCharge.size === 0) {
    return;
  }
  const entries = Array.from(state.nodeCharge.entries());
  for (const [nodeId, charge] of entries) {
    const metadata = brain.nodes.get(nodeId);
    const leakMultiplier = getNodeChargeLeak(metadata);
    const capacity = getNodeChargeCapacity(metadata);
    const decayed = Math.min(capacity, charge.value * leakMultiplier);
    setNodeChargeState(state, nodeId, decayed, capacity);
  }
}

function decayRecentChargeCache(state: BrainState): void {
  if (state.recentCharge.size === 0) {
    return;
  }
  const entries = Array.from(state.recentCharge.entries());
  for (const [nodeId, charge] of entries) {
    const nextTtl = Math.max(0, Math.round(charge.ttl ?? 0) - 1);
    if (nextTtl <= 0 || charge.value <= MIN_CHARGE_VALUE) {
      state.recentCharge.delete(nodeId);
      continue;
    }
    if (nextTtl !== charge.ttl) {
      state.recentCharge.set(nodeId, {
        value: charge.value,
        capacity: charge.capacity,
        ttl: nextTtl,
      });
    }
  }
}

function resolveReadyTarget(
  state: BrainState,
  brain: BrainGraphRuntime,
  candidates: BrainDecisionFactor[],
): BrainDecisionFactor | null {
  for (const candidate of candidates) {
    const metadata = brain.nodes.get(candidate.nodeId);
    const threshold = getNodeChargeCapacity(metadata);
    const charge = state.nodeCharge.get(candidate.nodeId)?.value ?? 0;
    if (charge >= threshold) {
      return candidate;
    }
  }
  return null;
}

function commitBrainTransition(state: BrainState, nextNodeId: string): void {
  if (state.nodeCharge.size > 0) {
    for (const [nodeId, charge] of state.nodeCharge.entries()) {
      const normalizedCapacity = charge.capacity > MIN_CHARGE_VALUE ? charge.capacity : DEFAULT_CHARGE_CAPACITY;
      const normalizedValue = Math.max(charge.value, 0);
      if (normalizedValue <= MIN_CHARGE_VALUE) {
        continue;
      }
      state.recentCharge.set(nodeId, {
        value: normalizedValue,
        capacity: normalizedCapacity,
        ttl: RECENT_CHARGE_TTL,
      });
      if (nodeId !== nextNodeId) {
        const weight = computeAssociationWeight(normalizedValue, normalizedCapacity);
        if (weight > 0) {
          registerRecentAssociation(state, nextNodeId, nodeId, weight);
        }
      }
    }
  }
  state.currentNodeId = nextNodeId;
  state.pendingPulses = [];
  state.nodeCharge.clear();
  resetNodeTimer(state);
}

function prunePulseEvents(state: BrainState, currentTick?: number): void {
  if (typeof currentTick !== 'number' || currentTick <= 0) {
    return;
  }
  const threshold = currentTick - PULSE_EVENT_TTL;
  if (threshold <= 0) {
    return;
  }
  state.pulseEvents = state.pulseEvents.filter((event) => event.startedTick >= threshold);
}

function makeEdgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

function computeAttentionModifier(
  contextEmbedding: ReadonlyArray<number>,
  candidateEmbedding: ReadonlyArray<number>,
): number {
  if (isZeroEmbedding(contextEmbedding) || isZeroEmbedding(candidateEmbedding)) {
    return 1;
  }
  const rawDot = dotProduct(contextEmbedding, candidateEmbedding);
  const clampedDot = Math.max(-1, Math.min(1, rawDot));
  const score = Math.exp(clampedDot * ATTENTION_GAIN);
  if (!Number.isFinite(score)) {
    return 1;
  }
  return Math.max(score, MIN_ATTENTION_SCORE);
}

function evaluateCandidates(
  brain: BrainGraphRuntime,
  state: BrainState,
  sourceNodeId: string,
  multipliers: BrainMultiplierSet,
): BrainDecisionFactor[] {
  const baseEdges = brain.edgesFrom.get(sourceNodeId) ?? [];
  const dynamicEdges = state.dynamicEdgesFrom.get(sourceNodeId) ?? [];
  if (baseEdges.length === 0 && dynamicEdges.length === 0) {
    return [];
  }

  const merged = new Map<string, BrainEdgeMetadata>();
  for (const edge of baseEdges) {
    if (!edge) {
      continue;
    }
    merged.set(edge.targetId, { targetId: edge.targetId, weight: edge.weight });
  }
  for (const edge of dynamicEdges) {
    if (!edge) {
      continue;
    }
    const existing = merged.get(edge.targetId);
    if (existing) {
      const combinedWeight = Math.max(existing.weight, edge.weight);
      merged.set(edge.targetId, { targetId: edge.targetId, weight: combinedWeight });
    } else {
      merged.set(edge.targetId, { targetId: edge.targetId, weight: edge.weight });
    }
  }

  if (merged.size === 0) {
    return [];
  }

  const sourceEdges = Array.from(merged.values());

  const candidates: BrainDecisionFactor[] = [];
  const contextEmbedding = state.contextEmbedding ?? createZeroEmbedding();
  for (const edge of sourceEdges) {
    const targetNode = requireNode(brain, edge.targetId);
    const adjustedWeight = applyPlasticityToWeight(state.plasticity, sourceNodeId, edge.targetId, edge.weight);
    const moodMultiplier = productForTags(targetNode.tags, multipliers.mood);
    const personalityMultiplier = productForTags(targetNode.tags, multipliers.personality);
    const demandMultiplier = productForTags(targetNode.tags, multipliers.demand);
    const relationshipMultiplier = productForTags(targetNode.tags, multipliers.relationship);
    const legacyMultiplier =
      moodMultiplier * personalityMultiplier * demandMultiplier * relationshipMultiplier;
    const attentionModifier = computeAttentionModifier(contextEmbedding, targetNode.embedding);
    const baseMultiplier = legacyMultiplier > 0 ? legacyMultiplier : 1;
    const blendedAttention = 1 + ATTENTION_BLEND * (attentionModifier - 1);
    const totalMultiplier = baseMultiplier * Math.max(blendedAttention, MIN_ATTENTION_SCORE);
    const attentionScore = attentionModifier;
    const plasticityAdjustment = adjustedWeight - edge.weight;
    const desirability =
      adjustedWeight * targetNode.baseFrequency * totalMultiplier;
    candidates.push({
      nodeId: targetNode.id,
      desirability,
      edgeWeight: adjustedWeight,
      baseWeight: edge.weight,
      plasticityAdjustment,
      baseFrequency: targetNode.baseFrequency,
      moodMultiplier,
      personalityMultiplier,
      demandMultiplier,
      relationshipMultiplier,
      totalMultiplier,
      attentionScore,
      embedding: targetNode.embedding,
      tags: targetNode.tags,
    });
  }
  candidates.sort((a, b) => b.desirability - a.desirability || a.nodeId.localeCompare(b.nodeId));
  return candidates;
}

function updateJumpEdges(
  state: BrainState,
  brain: BrainGraphRuntime,
  multipliers: BrainMultiplierSet,
  moodLevels: Record<string, number>,
): void {
  const moodMap = multipliers.mood ?? {};
  const traitSet = new Set(state.traitFlags);

  for (const key of Object.keys(state.jumpEdgeCooldowns)) {
    if (state.jumpEdgeCooldowns[key] > 0) {
      state.jumpEdgeCooldowns[key] -= 1;
      if (state.jumpEdgeCooldowns[key] <= 0) {
        delete state.jumpEdgeCooldowns[key];
      }
    }
  }

  const activeEntries = Array.from(state.activeJumpEdges.entries());
  for (const [edgeId, activeEdge] of activeEntries) {
    const definition = JUMP_EDGE_DEFINITIONS.find((entry) => entry.id === edgeId);
    if (!definition) {
      state.activeJumpEdges.delete(edgeId);
      continue;
    }

    const moodValue = resolveMoodLevel(definition.moodTrigger, moodMap, moodLevels);
    if (moodValue <= definition.releaseThreshold) {
      state.activeJumpEdges.delete(edgeId);
      state.jumpEdgeCooldowns[edgeId] = definition.cooldownTicks;
    }
  }

  for (const definition of JUMP_EDGE_DEFINITIONS) {
    if (state.activeJumpEdges.has(definition.id)) {
      continue;
    }

    if (definition.requiredTraits && definition.requiredTraits.some((trait) => !traitSet.has(trait))) {
      continue;
    }

    if (state.jumpEdgeCooldowns[definition.id] && state.jumpEdgeCooldowns[definition.id] > 0) {
      continue;
    }

    const resolved = resolveJumpEdge(brain, definition);
    if (!resolved) {
      continue;
    }

    const moodValue = resolveMoodLevel(definition.moodTrigger, moodMap, moodLevels);
    if (moodValue < definition.activationThreshold) {
      continue;
    }

    state.activeJumpEdges.set(definition.id, resolved);
  }
}

function resolveMoodLevel(
  key: string,
  multiplierMood: Record<string, number>,
  moodLevels: Record<string, number>,
): number {
  if (Number.isFinite(moodLevels[key])) {
    return moodLevels[key];
  }
  if (Number.isFinite(multiplierMood[key])) {
    return multiplierMood[key];
  }
  return 1;
}

function resolveJumpEdge(
  brain: BrainGraphRuntime,
  definition: (typeof JUMP_EDGE_DEFINITIONS)[number],
): ActiveJumpEdgeState | null {
  const targetNode = brain.nodes.get(definition.targetNodeId);
  if (!targetNode) {
    return null;
  }

  const sourceNodeIds = new Set<string>();
  if (definition.sourceNodes) {
    for (const source of definition.sourceNodes) {
      if (brain.nodes.has(source)) {
        sourceNodeIds.add(source);
      }
    }
  }
  if (definition.sourceTags) {
    for (const tag of definition.sourceTags) {
      const taggedNodes = brain.nodesByTag.get(tag);
      if (!taggedNodes) {
        continue;
      }
      for (const nodeId of taggedNodes) {
        sourceNodeIds.add(nodeId);
      }
    }
  }

  if (sourceNodeIds.size === 0) {
    return null;
  }

  const weight = definition.weight * definition.activationChance;
  return {
    id: definition.id,
    sourceNodeIds: Array.from(sourceNodeIds),
    targetNodeId: definition.targetNodeId,
    weight,
  };
}

function rebuildDynamicEdgeMap(
  activeJumpEdges: Map<string, ActiveJumpEdgeState>,
): Map<string, BrainEdgeMetadata[]> {
  const map = new Map<string, BrainEdgeMetadata[]>();
  for (const activeEdge of activeJumpEdges.values()) {
    for (const sourceNodeId of activeEdge.sourceNodeIds) {
      if (!map.has(sourceNodeId)) {
        map.set(sourceNodeId, []);
      }
      map.get(sourceNodeId)!.push({
        targetId: activeEdge.targetNodeId,
        weight: activeEdge.weight,
      });
    }
  }
  return map;
}

function computeAssociationWeight(value: number, capacity: number): number {
  if (value <= MIN_CHARGE_VALUE) {
    return 0;
  }
  const safeCapacity = capacity > MIN_CHARGE_VALUE ? capacity : DEFAULT_CHARGE_CAPACITY;
  const ratio = safeCapacity > MIN_CHARGE_VALUE ? clamp01(value / safeCapacity) : clamp01(value);
  if (ratio <= 0) {
    return 0;
  }
  const scaled = ratio * RECENT_ASSOCIATION_WEIGHT_SCALE;
  if (scaled <= RECENT_ASSOCIATION_MIN_WEIGHT) {
    return 0;
  }
  return clamp(scaled, RECENT_ASSOCIATION_MIN_WEIGHT, RECENT_ASSOCIATION_MAX_WEIGHT);
}

function registerRecentAssociation(
  state: BrainState,
  sourceNodeId: string,
  targetNodeId: string,
  weight: number,
): void {
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
    return;
  }
  if (weight <= RECENT_ASSOCIATION_MIN_WEIGHT) {
    return;
  }
  const key = makeEdgeKey(sourceNodeId, targetNodeId);
  const existing = state.recentAssociations.get(key);
  const nextWeight = existing
    ? clamp(Math.max(existing.weight, weight), RECENT_ASSOCIATION_MIN_WEIGHT, RECENT_ASSOCIATION_MAX_WEIGHT)
    : clamp(weight, RECENT_ASSOCIATION_MIN_WEIGHT, RECENT_ASSOCIATION_MAX_WEIGHT);
  const nextTtl = Math.max(RECENT_ASSOCIATION_TTL, existing?.ttl ?? 0);
  const existingDecay = existing?.decay;
  const decay = typeof existingDecay === 'number' && existingDecay > 0 && existingDecay < 1
    ? existingDecay
    : RECENT_ASSOCIATION_DECAY;
  state.recentAssociations.set(key, {
    sourceId: sourceNodeId,
    targetId: targetNodeId,
    weight: nextWeight,
    ttl: nextTtl,
    decay,
  });
}

function buildAssociationEdgeMap(state: BrainState): Map<string, BrainEdgeMetadata[]> {
  const map = new Map<string, BrainEdgeMetadata[]>();
  for (const association of state.recentAssociations.values()) {
    if (!association) {
      continue;
    }
    if (association.ttl <= 0 || association.weight <= RECENT_ASSOCIATION_MIN_WEIGHT) {
      continue;
    }
    if (!map.has(association.sourceId)) {
      map.set(association.sourceId, []);
    }
    map.get(association.sourceId)!.push({
      targetId: association.targetId,
      weight: association.weight,
    });
  }
  return map;
}

function mergeDynamicEdgeSources(
  ...sources: Array<Map<string, BrainEdgeMetadata[]>>
): Map<string, BrainEdgeMetadata[]> {
  const map = new Map<string, BrainEdgeMetadata[]>();
  for (const source of sources) {
    for (const [nodeId, edges] of source.entries()) {
      if (!map.has(nodeId)) {
        map.set(nodeId, []);
      }
      map.get(nodeId)!.push(...edges);
    }
  }
  return map;
}

function refreshDynamicEdgeCache(state: BrainState): void {
  const jumpEdges = rebuildDynamicEdgeMap(state.activeJumpEdges);
  const associationEdges = buildAssociationEdgeMap(state);
  state.dynamicEdgesFrom = mergeDynamicEdgeSources(jumpEdges, associationEdges);
}

function decayRecentAssociations(state: BrainState): void {
  if (state.recentAssociations.size === 0) {
    return;
  }
  const entries = Array.from(state.recentAssociations.entries());
  for (const [key, association] of entries) {
    if (!association) {
      state.recentAssociations.delete(key);
      continue;
    }
    if (!state.recentCharge.has(association.targetId)) {
      state.recentAssociations.delete(key);
      continue;
    }
    const decay = Number.isFinite(association.decay) && association.decay > 0 && association.decay < 1
      ? association.decay
      : RECENT_ASSOCIATION_DECAY;
    const nextWeight = association.weight * decay;
    const nextTtl = Math.max(0, Math.round(association.ttl ?? 0) - 1);
    if (nextTtl <= 0 || nextWeight <= RECENT_ASSOCIATION_MIN_WEIGHT) {
      state.recentAssociations.delete(key);
      continue;
    }
    state.recentAssociations.set(key, {
      sourceId: association.sourceId,
      targetId: association.targetId,
      weight: nextWeight,
      ttl: nextTtl,
      decay,
    });
  }
}

function restorePlasticityState(serialized: SerializedPlasticityState | undefined): PlasticityState {
  const state = createPlasticityState();
  if (!serialized) {
    return state;
  }

  state.tick = typeof serialized.tick === 'number' ? serialized.tick : 0;
  state.edges = new Map();

  const edges = serialized.edges ?? {};
  for (const [sourceId, targets] of Object.entries(edges)) {
    const targetMap = new Map<string, PlasticityEdgeState>();
    if (targets) {
      for (const [targetId, edgeState] of Object.entries(targets)) {
        if (edgeState) {
          targetMap.set(targetId, { ...edgeState });
        }
      }
    }
    state.edges.set(sourceId, targetMap);
  }

  return state;
}
