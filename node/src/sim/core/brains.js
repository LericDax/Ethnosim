import AdultMind from '../data/AdultMind_v1.json' assert { type: 'json' };
import BabyMind from '../data/BabyMind_v1.json' assert { type: 'json' };
import ChildMind from '../data/ChildMind_v1.json' assert { type: 'json' };
import TeenMind from '../data/TeenMind_v1.json' assert { type: 'json' };
import HouseMind from '../data/HouseMind_v1.json' assert { type: 'json' };
import UrbanMind from '../data/UrbanMind_v1.json' assert { type: 'json' };

const RAW_BRAINS = [
  AdultMind,
  BabyMind,
  ChildMind,
  TeenMind,
  HouseMind,
  UrbanMind,
];

/** @type {Map<string, BrainGraph>} */
const registry = new Map();
let initialized = false;

/**
 * Loads JSON assets and prepares fast lookup tables per brain graph.
 */
export function initBrains() {
  if (initialized) return registry;
  for (const data of RAW_BRAINS) {
    const graph = prepareGraph(data);
    registry.set(graph.name, graph);
  }
  initialized = true;
  return registry;
}

/**
 * Retrieves a brain graph by name.
 * @param {string} name
 * @returns {BrainGraph}
 */
export function getBrainGraph(name) {
  if (!initialized) initBrains();
  const brain = registry.get(name);
  if (!brain) {
    throw new Error(`Unknown brain graph: ${name}`);
  }
  return brain;
}

/**
 * Creates a fresh brain state for an entity using the specified graph.
 * @param {string} name
 * @returns {BrainState}
 */
export function createBrainState(name) {
  const graph = getBrainGraph(name);
  const node = graph.nodesById.get(graph.startNode);
  return {
    graph_name: graph.name,
    current_node: graph.startNode,
    node_timer: node?.duration ?? 1,
  };
}

/**
 * Returns node info (duration, tags, etc.) from a brain state.
 * @param {BrainState} state
 */
export function getCurrentNode(state) {
  const graph = getBrainGraph(state.graph_name);
  return graph.nodesById.get(state.current_node);
}

/**
 * @param {BrainGraph} graph
 * @param {string} nodeId
 */
export function getNode(graph, nodeId) {
  return graph.nodesById.get(nodeId);
}

function prepareGraph(data) {
  const nodesById = new Map();
  data.nodes.forEach((node, index) => {
    nodesById.set(node.id, { ...node, index });
  });
  const edgesBySource = new Map();
  data.edges.forEach(([from, to, weight]) => {
    const list = edgesBySource.get(from) ?? [];
    list.push({ to, weight });
    edgesBySource.set(from, list);
  });
  return {
    name: data.name,
    startNode: data.start_node,
    nodes: data.nodes,
    nodesById,
    edgesBySource,
  };
}

/**
 * @typedef {ReturnType<typeof prepareGraph>} BrainGraph
 */

/**
 * @typedef {Object} BrainState
 * @property {string} graph_name
 * @property {string} current_node
 * @property {number} node_timer
 */
