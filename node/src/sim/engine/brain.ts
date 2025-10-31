import adultMindRaw from '../data/AdultMind_v1.json?raw';
import babyMindRaw from '../data/BabyMind_v1.json?raw';
import childMindRaw from '../data/ChildMind_v1.json?raw';
import houseMindRaw from '../data/HouseMind_v1.json?raw';
import teenMindRaw from '../data/TeenMind_v1.json?raw';
import urbanMindRaw from '../data/UrbanMind_v1.json?raw';
import { JUMP_EDGE_DEFINITIONS } from './traits.ts';
import type { RngStream } from './rng.ts';
import {
  advancePlasticityState,
  applyPlasticityToWeight,
  createPlasticityState,
  registerPlasticityTransition,
  type PlasticityEdgeState,
  type PlasticityState,
} from './plasticity.ts';

export interface BrainNodeDefinition {
  id: string;
  base_freq: number;
  duration: number;
  tags: string[];
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

export interface BrainDecisionFactor {
  nodeId: string;
  desirability: number;
  edgeWeight: number;
  baseFrequency: number;
  moodMultiplier: number;
  personalityMultiplier: number;
  demandMultiplier: number;
  tags: string[];
}

export interface BrainDecision {
  fromNodeId: string;
  candidates: BrainDecisionFactor[];
  chosenNodeId: string;
}

interface BrainPulse {
  id: string;
  edgeKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  startedTick: number;
  travelDuration: number;
  elapsed: number;
  strength: number;
}

export interface BrainPulseEvent {
  id: string;
  edgeKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  startedTick: number;
  travelDuration: number;
  strength: number;
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
  nodeCharge: Map<string, number>;
  pulseEvents: BrainPulseEvent[];
  nextPulseId: number;
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

export interface SerializedPlasticityState {
  tick: number;
  edges: Record<string, Record<string, PlasticityEdgeState>>;
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
  nodeCharge: Record<string, number>;
  pulseEvents: BrainPulseEvent[];
  nextPulseId: number;
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
}

export interface BrainMultiplierSet {
  mood?: Record<string, number>;
  personality?: Record<string, number>;
  demand?: Record<string, number>;
}

interface BrainLibrary {
  [name: string]: BrainGraphRuntime;
}

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

const PULSE_THRESHOLD = 1;
const PULSE_EVENT_TTL = 128;
const PULSE_LEAK_MULTIPLIER = 0.96;
const PULSE_JITTER_RANGE = 0.18;
const MIN_CHARGE_VALUE = 1e-4;

function parseBrainJson(raw: string): BrainGraphDefinition {
  try {
    const parsed = JSON.parse(raw) as BrainGraphDefinition;
    return parsed;
  } catch (error) {
    throw new Error('Failed to parse brain JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
}

function buildRuntimeGraph(definition: BrainGraphDefinition): BrainGraphRuntime {
  const nodes = new Map<string, BrainNodeMetadata>();
  const nodesByTag = new Map<string, string[]>();
  for (const node of definition.nodes) {
    nodes.set(node.id, {
      id: node.id,
      baseFrequency: node.base_freq,
      duration: node.duration,
      tags: [...node.tags],
    });

    for (const tag of node.tags) {
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

export function createBrainState(brainId: string): BrainState {
  const brain = requireBrain(brainId);
  const startNode = requireNode(brain, brain.startNodeId);
  return {
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
    nodeCharge: new Map(),
    pulseEvents: [],
    nextPulseId: 1,
  };
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

  const plasticityEdges: Record<string, Record<string, PlasticityEdgeState>> = {};
  for (const [sourceId, targetMap] of state.plasticity.edges.entries()) {
    const serializedTargets: Record<string, PlasticityEdgeState> = {};
    for (const [targetId, edgeState] of targetMap.entries()) {
      serializedTargets[targetId] = { ...edgeState };
    }
    plasticityEdges[sourceId] = serializedTargets;
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
    })),
    nodeCharge: Object.fromEntries(state.nodeCharge.entries()),
    pulseEvents: state.pulseEvents.map((event) => ({
      id: event.id,
      edgeKey: event.edgeKey,
      sourceNodeId: event.sourceNodeId,
      targetNodeId: event.targetNodeId,
      startedTick: event.startedTick,
      travelDuration: event.travelDuration,
      strength: event.strength,
    })),
    nextPulseId: state.nextPulseId,
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
  base.pendingPulses = (serialized.pendingPulses ?? []).map((pulse) => ({
    id: pulse.id,
    edgeKey: pulse.edgeKey,
    sourceNodeId: pulse.sourceNodeId,
    targetNodeId: pulse.targetNodeId,
    startedTick: pulse.startedTick,
    travelDuration: pulse.travelDuration,
    elapsed: pulse.elapsed,
    strength: pulse.strength,
  }));
  base.nodeCharge = new Map(Object.entries(serialized.nodeCharge ?? {}));
  base.pulseEvents = (serialized.pulseEvents ?? []).map((event) => ({
    id: event.id,
    edgeKey: event.edgeKey,
    sourceNodeId: event.sourceNodeId,
    targetNodeId: event.targetNodeId,
    startedTick: event.startedTick,
    travelDuration: event.travelDuration,
    strength: event.strength,
  }));
  base.nextPulseId = typeof serialized.nextPulseId === 'number' ? serialized.nextPulseId : 1;
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
  let decision: BrainDecision | null = null;
  const metadata = requireNode(brain, state.currentNodeId);
  const candidates = evaluateCandidates(brain, state, state.currentNodeId, multipliers);

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
  const deposits = advancePendingPulses(state);
  applyNodeChargeDecay(state);
  for (const [targetId, strength] of deposits.entries()) {
    if (strength <= 0) {
      continue;
    }
    const existing = state.nodeCharge.get(targetId) ?? 0;
    state.nodeCharge.set(targetId, existing + strength);
  }

  if (state.nodeTimer > 0) {
    state.nodeTimer = Math.max(0, state.nodeTimer - 1);
  }

  if (state.nodeTimer <= 0) {
    const bestCandidate = candidates[0];
    if (bestCandidate) {
      const currentCharge = state.nodeCharge.get(bestCandidate.nodeId) ?? 0;
      if (currentCharge < PULSE_THRESHOLD) {
        state.nodeCharge.set(bestCandidate.nodeId, PULSE_THRESHOLD);
      }
    }
  }

  const readyTarget = resolveReadyTarget(state, candidates);
  if (readyTarget) {
    const fromNodeId = state.currentNodeId;
    const nextNodeId = readyTarget.nodeId;
    decision = {
      fromNodeId,
      candidates,
      chosenNodeId: nextNodeId,
    };
    registerPlasticityTransition(state.plasticity, fromNodeId, nextNodeId);
    state.lastDecision = decision;
    commitBrainTransition(state, nextNodeId);
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
      baseFrequency: candidate.baseFrequency,
      moodMultiplier: candidate.moodMultiplier,
      personalityMultiplier: candidate.personalityMultiplier,
      demandMultiplier: candidate.demandMultiplier,
      tags: [...candidate.tags],
    })),
  } satisfies BrainDecision;
}

function distributePulseBudget(
  state: BrainState,
  candidates: BrainDecisionFactor[],
  metadata: BrainNodeMetadata,
  context: BrainTickContext,
): void {
  const duration = Math.max(1, metadata.duration);
  const baseBudget = 1 / duration;
  const totalDesirability = candidates.reduce((sum, candidate) => {
    return candidate.desirability > 0 ? sum + candidate.desirability : sum;
  }, 0);
  if (totalDesirability <= 0 || baseBudget <= 0) {
    return;
  }

  prunePulseEvents(state, context.tick);

  const rng = context.rng ?? null;
  const jitterRange = PULSE_JITTER_RANGE;
  const travelDuration = Math.max(1, Math.round(duration * 0.5));
  const currentTick = typeof context.tick === 'number' ? context.tick : 0;

  const provisionalStrengths: number[] = [];
  for (const candidate of candidates) {
    if (candidate.desirability <= 0) {
      provisionalStrengths.push(0);
      continue;
    }
    const share = candidate.desirability / totalDesirability;
    let jitter = 0;
    if (rng) {
      jitter = (rng.nextFloat() * 2 - 1) * jitterRange;
    }
    const strength = Math.max(0, baseBudget * share * (1 + jitter));
    provisionalStrengths.push(strength);
  }

  const provisionalTotal = provisionalStrengths.reduce((sum, value) => sum + value, 0);
  const normalization = provisionalTotal > 0 ? baseBudget / provisionalTotal : 0;

  const normalizedStrengths = provisionalStrengths.map((value) => value * normalization);
  const nextPending: BrainPulse[] = [];
  const nextEvents: BrainPulseEvent[] = [];
  let index = 0;
  for (const candidate of candidates) {
    const strength = normalizedStrengths[index];
    index += 1;
    if (!strength || strength <= MIN_CHARGE_VALUE) {
      continue;
    }
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
      strength,
    };
    nextPending.push(pulse);
    nextEvents.push({
      id: pulseId,
      edgeKey,
      sourceNodeId: pulse.sourceNodeId,
      targetNodeId: pulse.targetNodeId,
      startedTick: currentTick,
      travelDuration,
      strength,
    });
  }

  if (nextPending.length > 0) {
    state.pendingPulses.push(...nextPending);
  }
  if (nextEvents.length > 0) {
    state.pulseEvents.push(...nextEvents);
  }
}

function advancePendingPulses(state: BrainState): Map<string, number> {
  if (state.pendingPulses.length === 0) {
    return new Map();
  }
  const deposits = new Map<string, number>();
  const remaining: BrainPulse[] = [];
  for (const pulse of state.pendingPulses) {
    pulse.elapsed += 1;
    if (pulse.elapsed >= pulse.travelDuration) {
      const existing = deposits.get(pulse.targetNodeId) ?? 0;
      deposits.set(pulse.targetNodeId, existing + pulse.strength);
    } else {
      remaining.push(pulse);
    }
  }
  state.pendingPulses = remaining;
  return deposits;
}

function applyNodeChargeDecay(state: BrainState): void {
  if (state.nodeCharge.size === 0) {
    return;
  }
  for (const [nodeId, value] of state.nodeCharge.entries()) {
    const decayed = value * PULSE_LEAK_MULTIPLIER;
    if (decayed <= MIN_CHARGE_VALUE) {
      state.nodeCharge.delete(nodeId);
    } else {
      state.nodeCharge.set(nodeId, decayed);
    }
  }
}

function resolveReadyTarget(
  state: BrainState,
  candidates: BrainDecisionFactor[],
): BrainDecisionFactor | null {
  for (const candidate of candidates) {
    const charge = state.nodeCharge.get(candidate.nodeId) ?? 0;
    if (charge >= PULSE_THRESHOLD) {
      return candidate;
    }
  }
  return null;
}

function commitBrainTransition(state: BrainState, nextNodeId: string): void {
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

function evaluateCandidates(
  brain: BrainGraphRuntime,
  state: BrainState,
  sourceNodeId: string,
  multipliers: BrainMultiplierSet,
): BrainDecisionFactor[] {
  const baseEdges = brain.edgesFrom.get(sourceNodeId) ?? [];
  const jumpEdges = state.dynamicEdgesFrom.get(sourceNodeId) ?? [];
  const sourceEdges = baseEdges.length > 0 || jumpEdges.length > 0 ? [...baseEdges, ...jumpEdges] : [];
  if (sourceEdges.length === 0) {
    return [];
  }

  const candidates: BrainDecisionFactor[] = [];
  for (const edge of sourceEdges) {
    const targetNode = requireNode(brain, edge.targetId);
    const adjustedWeight = applyPlasticityToWeight(state.plasticity, sourceNodeId, edge.targetId, edge.weight);
    const moodMultiplier = productForTags(targetNode.tags, multipliers.mood);
    const personalityMultiplier = productForTags(targetNode.tags, multipliers.personality);
    const demandMultiplier = productForTags(targetNode.tags, multipliers.demand);
    const desirability =
      adjustedWeight * targetNode.baseFrequency * moodMultiplier * personalityMultiplier * demandMultiplier;
    candidates.push({
      nodeId: targetNode.id,
      desirability,
      edgeWeight: adjustedWeight,
      baseFrequency: targetNode.baseFrequency,
      moodMultiplier,
      personalityMultiplier,
      demandMultiplier,
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

  state.dynamicEdgesFrom = rebuildDynamicEdgeMap(state.activeJumpEdges);
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
