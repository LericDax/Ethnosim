/**
 * @typedef {Object} Demand
 * @property {string} source_id
 * @property {string} scope
 * @property {[number, number]} origin
 * @property {number} radius
 * @property {string[]} targets
 * @property {number} multiplier
 * @property {number} expires_at_tick
 */

/**
 * Constructs a demand descriptor.
 * @param {Partial<Demand>} opts
 * @returns {Demand}
 */
export function createDemand(opts) {
  if (!opts) throw new Error('Demand options missing');
  const {
    source_id,
    scope = 'house',
    origin = [0, 0],
    radius = 8,
    targets = [],
    multiplier = 1.2,
    expires_at_tick = 0,
  } = opts;
  return {
    source_id: source_id ?? 'unknown',
    scope,
    origin,
    radius,
    targets,
    multiplier,
    expires_at_tick,
  };
}

/**
 * Filters out demands that have expired.
 * @param {Demand[]} demands
 * @param {number} tick
 */
export function pruneExpiredDemands(demands, tick) {
  return demands.filter((d) => d.expires_at_tick > tick);
}

/**
 * Computes the multiplier from demands affecting the agent at the node.
 * @param {Demand[]} demands
 * @param {{x:number,y:number}} agent
 * @param {{id:string}} node
 * @param {number} tick
 */
export function getDemandMultiplier(demands, agent, node, tick) {
  if (!demands?.length) return 1;
  let multiplier = 1;
  for (const demand of demands) {
    if (demand.expires_at_tick <= tick) continue;
    if (!demand.targets?.includes(node.id)) continue;
    const dist = distance(agent.x, agent.y, demand.origin[0], demand.origin[1]);
    if (dist <= demand.radius) {
      multiplier *= demand.multiplier;
    }
  }
  return multiplier;
}

function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}
