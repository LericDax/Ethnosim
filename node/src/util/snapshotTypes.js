/**
 * @typedef {Object} Snapshot
 * @property {'SNAPSHOT'} type - Message discriminator.
 * @property {number} seed - Seed used to initialize the RNG.
 * @property {number} tick - Simulation tick count.
 * @property {{w:number,h:number}} world - Dimensions of the world grid.
 * @property {SnapshotAgent[]} agents - Agents present in the simulation.
 * @property {SnapshotHouse[]} houses - Household collectives.
 * @property {SnapshotCity|null} city - The urban collective (if any).
 * @property {SnapshotDemand[]} demands - Active demand modifiers.
 * @property {SnapshotStageStats} stats - Aggregated population counts.
 */

/**
 * @typedef {Object} SnapshotAgent
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {'baby'|'child'|'teen'|'adult'} age_stage
 * @property {string|null} brain_node
 * @property {string} house_id
 * @property {boolean} pregnant
 */

/**
 * @typedef {Object} SnapshotHouse
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} authority
 * @property {string[]} members
 * @property {string|null} brain_node
 */

/**
 * @typedef {Object} SnapshotCity
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} authority
 * @property {string|null} brain_node
 */

/**
 * @typedef {Object} SnapshotDemand
 * @property {string} source_id
 * @property {string} scope
 * @property {[number, number]} origin
 * @property {number} radius
 * @property {string[]} targets
 * @property {number} multiplier
 * @property {number} expires_at_tick
 */

/**
 * @typedef {Object} SnapshotStageStats
 * @property {number} baby
 * @property {number} child
 * @property {number} teen
 * @property {number} adult
 */
