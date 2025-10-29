/**
 * @typedef SnapshotAgent
 * @property {string} id Unique identifier for the agent.
 * @property {string} lifeStage Lifecycle label (baby | child | teen | adult | elder).
 * @property {number} x Tile-space X coordinate.
 * @property {number} y Tile-space Y coordinate.
 * @property {{
 *   morale: number,
 *   stress: number,
 *   loyalty: number,
 *   [mood: string]: number,
 * }} moods Normalized agent affect channels used by the brains.
 * @property {{
 *   householdId?: string,
 *   pairBondId?: string|null,
 *   dependents?: string[],
 * }} bonds Household and relationship bindings.
 * @property {number} movementAngle Facing direction in radians for renderer hints.
 * @property {number} speedTilesPerTick Movement speed magnitude.
 */

/**
 * @typedef SnapshotHouseholdMember
 * @property {string} agentId
 * @property {string} role Household role (head, mate, child, elder, dependant).
 */

/**
 * @typedef SnapshotHouse
 * @property {string} id Unique household identifier.
 * @property {string} name Designer-friendly label.
 * @property {{ x: number, y: number }} centroid Tile coordinate used for overlays.
 * @property {{
 *   cohesion: number,
 *   wealth: number,
 *   devotion: number,
 *   [mood: string]: number,
 * }} moods Aggregated household mood channels.
 * @property {SnapshotHouseholdMember[]} members Household roster with role hints.
 * @property {{ tributeOwed: number, tributePaid: number }} tribute Annual civic obligations.
 */

/**
 * @typedef SnapshotCity
 * @property {string} id
 * @property {string} name
 * @property {{ x: number, y: number }} seat Approximate town center coordinate.
 * @property {{
 *   stability: number,
 *   unrest: number,
 *   ambition: number,
 *   [mood: string]: number,
 * }} moods Civic affect channels derived from minds.
 * @property {string[]} households Household identifiers currently pledged to the city.
 * @property {{ foodStores: number, influence: number }} resources Lightweight economic state.
 */

/**
 * @typedef Snapshot
 * @property {number} tick Current deterministic tick count of the simulation.
 * @property {number} seed Seed used to initialize deterministic RNG on the worker.
 * @property {[number, number]} worldSize Width/height tuple so renderers can scale projections.
 * @property {number} ticksPerUpdate Number of internal ticks advanced between published snapshots.
 * @property {SnapshotAgent[]} agents Flat list of agents visible to the renderer.
 * @property {SnapshotHouse[]} houses Household-level overlays for UI.
 * @property {SnapshotCity|null} city Aggregate civic level state (optional).
 * @property {{ generatedAt: number }} meta Additional metadata such as timestamp (ms).
 */

export {}; // eslint-disable-line
