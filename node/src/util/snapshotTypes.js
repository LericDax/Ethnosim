/**
 * @typedef {Object} Snapshot
 * @property {number} tick - Simulation tick count.
 * @property {SnapshotAgent[]} agents - Agents present in the simulation.
 */

/**
 * @typedef {Object} SnapshotAgent
 * @property {string} id
 * @property {string} lifeStage
 */

/**
 * @typedef {Object} SnapshotHouse
 * @property {string} id
 * @property {string[]} members
 */

/**
 * @typedef {Object} SnapshotCity
 * @property {string} id
 * @property {string[]} households
 */
