import adultMindRaw from '../data/AdultMind_v1.json?raw';
import babyMindRaw from '../data/BabyMind_v1.json?raw';
import childMindRaw from '../data/ChildMind_v1.json?raw';
import houseMindRaw from '../data/HouseMind_v1.json?raw';
import teenMindRaw from '../data/TeenMind_v1.json?raw';
import urbanMindRaw from '../data/UrbanMind_v1.json?raw';

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
  startNodeId: string;
}

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
  for (const node of definition.nodes) {
    nodes.set(node.id, {
      id: node.id,
      baseFrequency: node.base_freq,
      duration: node.duration,
      tags: [...node.tags],
    });
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

function evaluateCandidates(
  brain: BrainGraphRuntime,
  sourceNodeId: string,
  multipliers: BrainMultiplierSet,
): BrainDecisionFactor[] {
  const sourceEdges = brain.edgesFrom.get(sourceNodeId);
  if (!sourceEdges || sourceEdges.length === 0) {
    return [];
  }

  const candidates: BrainDecisionFactor[] = [];
  for (const edge of sourceEdges) {
    const targetNode = requireNode(brain, edge.targetId);
    const moodMultiplier = productForTags(targetNode.tags, multipliers.mood);
    const personalityMultiplier = productForTags(targetNode.tags, multipliers.personality);
    const demandMultiplier = productForTags(targetNode.tags, multipliers.demand);
    const desirability =
      edge.weight * targetNode.baseFrequency * moodMultiplier * personalityMultiplier * demandMultiplier;
    candidates.push({
      nodeId: targetNode.id,
      desirability,
      edgeWeight: edge.weight,
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

export function createBrainState(brainId: string): BrainState {
  const brain = requireBrain(brainId);
  const startNode = requireNode(brain, brain.startNodeId);
  return {
    brainId,
    currentNodeId: startNode.id,
    nodeTimer: startNode.duration,
    lastDecision: null,
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

export function tickBrain(state: BrainState, multipliers: BrainMultiplierSet = {}): BrainTickResult {
  const brain = requireBrain(state.brainId);
  let decision: BrainDecision | null = null;

  if (state.nodeTimer > 1) {
    state.nodeTimer -= 1;
  } else {
    const candidates = evaluateCandidates(brain, state.currentNodeId, multipliers);
    const chosen = candidates.length > 0 ? candidates[0] : null;
    const nextNodeId = chosen ? chosen.nodeId : state.currentNodeId;
    decision = {
      fromNodeId: state.currentNodeId,
      candidates,
      chosenNodeId: nextNodeId,
    };
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
