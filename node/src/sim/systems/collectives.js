import { getBrainGraph } from '../core/brains.js';
import { createDemand, pruneExpiredDemands } from '../core/demands.js';

const HOUSE_NODE_DEMANDS = {
  FortifyHome: { targets: ['Patrol', 'MarkTerritory', 'BuildDwelling', 'Rest'], radius: 10, multiplier: 1.25, duration: 48 },
  ProtectYoung: { targets: ['HideWhenScared', 'FollowCaregiver', 'Patrol'], radius: 12, multiplier: 1.3, duration: 60 },
  NurtureHeir: { targets: ['ImitateRitual', 'ShowLoyalty', 'CourtAlly'], radius: 10, multiplier: 1.25, duration: 60 },
  EnsureLineage: { targets: ['CourtAlly', 'ShowLoyalty', 'ProveMyself'], radius: 14, multiplier: 1.2, duration: 60 },
  AccumulateStock: { targets: ['Gather', 'Stockpile', 'FetchSmallThings'], radius: 10, multiplier: 1.3, duration: 72 },
  AvengeSlight: { targets: ['Patrol', 'MarkTerritory', 'ChallengeBorder', 'ProveMyself'], radius: 14, multiplier: 1.35, duration: 48 },
};

const CITY_NODE_DEMANDS = {
  CollectTribute: { targets: ['Gather', 'Stockpile', 'FetchSmallThings'], radius: 20, multiplier: 1.25, duration: 96 },
  MaintainOrder: { targets: ['Rest', 'FollowCaregiver', 'ShowLoyalty'], radius: 18, multiplier: 1.2, duration: 96 },
  ProjectDoctrine: { targets: ['ImitateRitual', 'ShowLoyalty', 'Socialize'], radius: 18, multiplier: 1.3, duration: 96 },
  AbsorbYouth: { targets: ['ShowLoyalty', 'ImitateRitual', 'ProveMyself'], radius: 22, multiplier: 1.4, duration: 96 },
  SanctifyBirth: { targets: ['CryForCare', 'Feed', 'SleepWarm'], radius: 15, multiplier: 1.35, duration: 96 },
  SuppressRivals: { targets: ['Patrol', 'MarkTerritory', 'ChallengeBorder'], radius: 22, multiplier: 1.35, duration: 96 },
};

/**
 * Updates HouseMind and UrbanMind brains and emits demands.
 * @param {Array} houses
 * @param {Object} city
 * @param {Array} agents
 * @param {number} tick
 * @param {{cx:number,cy:number}} world
 * @param {import('../core/rng.js').RNG} rng
 * @param {Array} activeDemands
 */
export function tickCollectives(houses, city, agents, tick, world, rng, activeDemands = []) {
  let demands = pruneExpiredDemands(activeDemands, tick);

  for (const house of houses) {
    const changed = stepCollectiveBrain(house, rng);
    if (changed) {
      const demandConfig = HOUSE_NODE_DEMANDS[house.brain.current_node];
      if (demandConfig) {
        demands = addDemand(demands, house, demandConfig, tick, 'house');
      }
    }
  }

  if (city) {
    const changed = stepCollectiveBrain(city, rng);
    if (changed) {
      const demandConfig = CITY_NODE_DEMANDS[city.brain.current_node];
      if (demandConfig) {
        demands = addDemand(demands, city, demandConfig, tick, 'city');
      }
    }
  }

  return demands;
}

function stepCollectiveBrain(entity, rng) {
  if (!entity.brain) return false;
  const brain = entity.brain;
  const graph = getBrainGraph(brain.graph_name);
  brain.node_timer -= 1;
  if (brain.node_timer > 0) return false;

  const current = graph.nodesById.get(brain.current_node);
  const edges = graph.edgesBySource.get(current?.id) ?? [];
  if (!edges.length) {
    brain.node_timer = current?.duration ?? 12;
    return true;
  }

  let total = 0;
  const weights = edges.map((edge) => {
    const node = graph.nodesById.get(edge.to);
    const weight = Math.max(0, edge.weight * (node?.base_freq ?? 1));
    total += weight;
    return weight;
  });
  let nextNode;
  if (total <= 0) {
    nextNode = graph.nodesById.get(edges[0].to);
  } else {
    const r = rng.nextFloat() * total;
    let acc = 0;
    for (let i = 0; i < edges.length; i++) {
      acc += weights[i];
      if (r <= acc) {
        nextNode = graph.nodesById.get(edges[i].to);
        break;
      }
    }
  }
  if (!nextNode) {
    nextNode = graph.nodesById.get(graph.startNode);
  }
  brain.current_node = nextNode.id;
  brain.node_timer = nextNode.duration ?? (brain.graph_name === 'UrbanMind_v1' ? 72 : 12);
  return true;
}

function addDemand(demands, entity, config, tick, scope) {
  const demand = createDemand({
    source_id: entity.id,
    scope,
    origin: [entity.x, entity.y],
    radius: config.radius,
    targets: config.targets,
    multiplier: config.multiplier,
    expires_at_tick: tick + config.duration,
  });
  return [...demands, demand];
}
