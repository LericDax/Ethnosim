import adultMindRaw from '../data/AdultMind_v1.json?raw';
import babyMindRaw from '../data/BabyMind_v1.json?raw';
import childMindRaw from '../data/ChildMind_v1.json?raw';
import houseMindRaw from '../data/HouseMind_v1.json?raw';
import teenMindRaw from '../data/TeenMind_v1.json?raw';
import urbanMindRaw from '../data/UrbanMind_v1.json?raw';
import { JUMP_EDGE_DEFINITIONS } from './traits.ts';
import {
  advancePlasticityState,
  applyPlasticityToWeight,
  createPlasticityState,
  registerPlasticityTransition,
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
  };
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

export function tickBrain(
  state: BrainState,
  multipliers: BrainMultiplierSet = {},
  moodLevels: Record<string, number> = {},
): BrainTickResult {
  const brain = requireBrain(state.brainId);
  advancePlasticityState(state.plasticity);
  updateJumpEdges(state, brain, multipliers, moodLevels);
  let decision: BrainDecision | null = null;

  if (state.nodeTimer > 1) {
    state.nodeTimer -= 1;
  } else {
    const candidates = evaluateCandidates(brain, state, state.currentNodeId, multipliers);
    const chosen = candidates.length > 0 ? candidates[0] : null;
    const fromNodeId = state.currentNodeId;
    const nextNodeId = chosen ? chosen.nodeId : fromNodeId;
    decision = {
      fromNodeId,
      candidates,
      chosenNodeId: nextNodeId,
    };
    if (chosen) {
      registerPlasticityTransition(state.plasticity, fromNodeId, chosen.nodeId);
    }
    state.lastDecision = decision;
    resetNodeTimer(state, nextNodeId);
  }

  const metadata = requireNode(brain, state.currentNodeId);
  return {
    state,
    nodeDuration: metadata.duration,
    decision: decision ?? state.lastDecision,
  };
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
