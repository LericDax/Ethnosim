/**
 * @typedef {Object} SnapshotAgent
 * @property {string} id - Stable identifier for the agent.
 * @property {number} x - X coordinate within the world grid.
 * @property {number} y - Y coordinate within the world grid.
 * @property {'baby'|'child'|'teen'|'adult'} lifeStage - Lifecycle band used for rendering.
 * @property {Object<string, number>=} carriedResources - Lightweight resource bundle carried by the agent.
 * @property {{harvested?: Object<string, number>, delivered?: Object<string, number>}=} resourceActivity - Per-tick harvest/delivery bookkeeping.
 */

/**
 * @typedef {Object} SnapshotHouse
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string[]} members
 * @property {Object<string, number>=} stockpiles
 * @property {{active?: boolean, progress?: number, required?: number, cooldownUntil?: number}=} construction
 * @property {string=} primaryLeaderId
 * @property {SnapshotLeader[]=} leaders
 * @property {Object<string, number>=} leaderDirectives
 */

/**
 * @typedef {Object} SnapshotCity
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string[]} households
 * @property {Object<string, number>=} stockpiles
 * @property {string=} primaryLeaderId
 * @property {SnapshotLeader[]=} leaders
 * @property {Object<string, number>=} leaderDirectives
 */

/**
 * @typedef {Object} SnapshotLeader
 * @property {string} agentId
 * @property {string=} role
 * @property {string=} title
 * @property {string=} method
 * @property {number=} score
 * @property {number=} support
 * @property {number=} selectedAtTick
 * @property {Object<string, number>=} temperament
 * @property {string[]=} traitFlags
 * @property {string=} notes
 */

/**
 * @typedef {Object} Snapshot
 * @property {'SNAPSHOT'} type - Message discriminator.
 * @property {number} version - Snapshot schema version.
 * @property {number} tick - Simulation tick counter.
 * @property {{width:number,height:number}} world - Dimensions of the simulated terrain.
 * @property {SnapshotAgent[]} agents - Agents reported for this tick.
 * @property {SnapshotHouse[]} houses - Household aggregates (may be empty).
 * @property {SnapshotCity|null} city - Urban aggregate (optional).
 * @property {{houses?: Object<string, SnapshotLeader[]>, city?: SnapshotLeader[], updatedAtTick?: number}=} leadership -
 *   Leadership overlays for quick HUD display.
 */

export {};
