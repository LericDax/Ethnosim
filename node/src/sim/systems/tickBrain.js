import { getBrainGraph } from '../core/brains.js';
import { computeMoodMultiplier, decayMoods, applyNodeMoodEffects } from '../core/moods.js';
import { temperamentMultiplier } from '../core/agents.js';
import { getDemandMultiplier } from '../core/demands.js';

/**
 * Steps every agent brain once per tick.
 * @param {Array} agents
 * @param {Array} houses
 * @param {Object} city
 * @param {number} tick
 * @param {Object} world
 * @param {import('../core/rng.js').RNG} rng
 * @param {Array} demands
 */
export function tickAllBrains(agents, houses, city, tick, world, rng, demands) {
  for (const agent of agents) {
    const brain = agent.brain;
    if (!brain) continue;
    brain.node_timer -= 1;
    const graph = getBrainGraph(brain.graph_name);
    const currentNode = graph.nodesById.get(brain.current_node);

    if (brain.node_timer <= 0) {
      const nextNode = selectNextNode(agent, graph, currentNode, rng, demands, tick);
      brain.current_node = nextNode.id;
      brain.node_timer = nextNode.duration ?? 1;
      applyNodeMoodEffects(agent.moods, nextNode);
    }
    decayMoods(agent.moods);
  }
}

function selectNextNode(agent, graph, currentNode, rng, demands, tick) {
  const edges = graph.edgesBySource.get(currentNode?.id) ?? [];
  if (!edges.length) {
    return currentNode ?? graph.nodesById.get(graph.startNode);
  }

  let total = 0;
  const weights = edges.map((edge) => {
    const node = graph.nodesById.get(edge.to);
    const moodMul = computeMoodMultiplier(agent.moods, node);
    const temperMul = temperamentMultiplier(agent.temperament, node);
    const demandMul = getDemandMultiplier(demands, agent, node, tick);
    const weight = Math.max(0, edge.weight * (node?.base_freq ?? 1) * moodMul * temperMul * demandMul);
    total += weight;
    return weight;
  });

  if (total <= 0) {
    return currentNode ?? graph.nodesById.get(graph.startNode);
  }

  const r = rng.nextFloat() * total;
  let acc = 0;
  for (let i = 0; i < edges.length; i++) {
    acc += weights[i];
    if (r <= acc) {
      return graph.nodesById.get(edges[i].to);
    }
  }
  return graph.nodesById.get(edges[edges.length - 1].to);
}
