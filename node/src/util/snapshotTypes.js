/**
 * @typedef {Object} Snapshot
 * @property {number} tick - Simulation tick count.
 * @property {[number, number]} worldSize - Width/height of the world grid.
 * @property {SnapshotAgent[]} agents - Agents present in the simulation.
 * @property {SnapshotHouse[]} [houses]
 * @property {SnapshotCity[]} [cities]
 */

/**
 * @typedef {Object} SnapshotAgent
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string} lifeStage
 */

/**
 * @typedef {Object} SnapshotHouse
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string[]} members
 */

/**
 * @typedef {Object} SnapshotCity
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {string[]} households
 */
