import { createSnapshot, type SimulationState } from '../sim.worker.ts';
import { cloneBrainDecision, serializeBrainState, type SerializedBrainState } from '../engine/brain.ts';
import type { BrainDecision } from '../engine/brain.ts';
import type { SerializedSeededRng, SerializedRngStream } from '../engine/rng.ts';
import type { WorldState } from '../engine/world.ts';
import type { AgentState, PregnancyState } from '../sim.worker.ts';
import type { MovementState } from '../engine/move.ts';
import {
  HOUSE_CONSTRUCTION_COST,
  cloneLeaderDescriptor,
  type CityState,
  type CollectiveLeaderDescriptor,
  type HouseState,
  serializeHouseCapacityController,
  type SerializedHouseCapacityController,
} from '../engine/collectives.ts';
import {
  RESOURCE_TYPES,
  cloneResourceBundle as cloneBundle,
  type ResourceType,
} from '../engine/resources.ts';
import {
  cloneAgentChromosomes,
  cloneChromosomeRegistry,
  type ChromosomeRegistry,
} from '../engine/chromosomes.ts';

export const DB_NAME = 'ethnosim-snapshots';
export const STORE_NAME = 'snapshots';
export const DB_VERSION = 1;

export interface SerializedAgentState {
  id: string;
  x: number;
  y: number;
  lifeStage: AgentState['lifeStage'];
  ageTicks: number;
  speed: number;
  homeX: number;
  homeY: number;
  caregiverId: string | null;
  explorationBias: number;
  brain: SerializedBrainState;
  brainMultipliers: AgentState['brainMultipliers'];
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  chromosomes: AgentState['chromosomes'];
  reproductiveRoles: AgentState['reproductiveRoles'];
  sexBody?: 'male' | 'female';
  genderIdentity: AgentState['genderIdentity'];
  fertility: number;
  pregnancy: PregnancyState | null;
  bondPartnerId: string | null;
  reproductiveGroupId: string | null;
  reproductiveGroupRole: string | null;
  parents: string[];
  temperament: AgentState['temperament'];
  traitFlags: string[];
  moods: Record<string, number>;
  houseId: string | null;
  carriedResources: AgentState['carriedResources'];
  resourceActivity: AgentState['resourceActivity'];
  movement: SerializedMovementState;
}

export interface SerializedMovementState {
  behaviorId: string | null;
  target: { x: number; y: number } | null;
  waypoints: Array<{ x: number; y: number }> | null;
  waypointIndex: number;
  timer: number;
  lingerTicks: number;
  data: Record<string, unknown>;
  sameNodeId: string | null;
  sameNodeTicks: number;
  sameNodeLimit: number;
}

export interface SerializedReproductiveGroup {
  id: string;
  formedAtTick: number;
  members: { agentId: string; role: string }[];
}

export interface SerializedHouseState {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxMembers: number;
  preferredMembers: number | null;
  capacityPressure: number;
  archetypeId: string | null;
  brain: SerializedBrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  members: string[];
  activeDemand: Record<string, number>;
  stockpiles: HouseState['stockpiles'];
  resourceNeeds?: HouseState['resourceNeeds'];
  construction: HouseState['construction'];
  primaryLeaderId: string | null;
  leaders: CollectiveLeaderDescriptor[];
  leaderDirectives: Record<string, number>;
}

export interface SerializedCityState {
  id: string;
  x: number;
  y: number;
  radius: number;
  brain: SerializedBrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  activeDemand: Record<string, number>;
  demandExpiresAt: number;
  stockpiles: CityState['stockpiles'];
  resourceNeeds?: CityState['resourceNeeds'];
  primaryLeaderId: string | null;
  leaders: CollectiveLeaderDescriptor[];
  leaderDirectives: Record<string, number>;
}

export interface SerializedTerrainLayer {
  width: number;
  height: number;
  tiles: WorldState['terrain']['tiles'];
}

export interface SerializedWorldResources {
  stocks: Record<ResourceType, number[]>;
  capacities: Record<ResourceType, number[]>;
  regenRates: Record<ResourceType, number[]>;
  depletion: Record<ResourceType, number[]>;
}

export interface SerializedWorldState {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  climateSeed: number;
  terrain: SerializedTerrainLayer;
  resources: SerializedWorldResources;
  /** @deprecated retained for backward compatibility */
  forestResources?: number[];
  /** @deprecated retained for backward compatibility */
  forestResourceCapacity?: number;
}

export interface SerializedSimulationRng {
  root: SerializedSeededRng;
  streams: {
    world: SerializedRngStream;
    agentSpawn: SerializedRngStream;
    tick: SerializedRngStream;
    collectives: SerializedRngStream;
  };
}

export interface SerializedRandomnessMetadata {
  mode: SimulationState['randomnessMode'];
  runId: string;
  rootSeed: string | null;
}

export interface SerializedSimulationState {
  version: number;
  tick: number;
  scenarioId: string;
  seed: string;
  randomnessMode: SimulationState['randomnessMode'];
  randomness: SerializedRandomnessMetadata | null;
  world: SerializedWorldState;
  agents: SerializedAgentState[];
  houses: SerializedHouseState[];
  city: SerializedCityState | null;
  rng: SerializedSimulationRng | null;
  stageCounts: SimulationState['stageCounts'];
  nextAgentId: number;
  nextHouseId: number;
  reproductiveGroups: SerializedReproductiveGroup[];
  nextReproductiveGroupId: number;
  chromosomes: ChromosomeRegistry;
  leadership: SerializedLeadershipState;
  housing: SerializedHouseCapacityController;
  pendingHouseAssignments: string[];
}

export interface SerializedLeadershipState {
  houses: Record<string, CollectiveLeaderDescriptor[]>;
  city: CollectiveLeaderDescriptor[];
  updatedAtTick: number;
}

export interface PersistedSnapshotRecord {
  id: string;
  savedAt: number;
  tick: number;
  scenarioId: string;
  snapshot: ReturnType<typeof createSnapshot>;
  state: SerializedSimulationState;
}

export function serializeSimulationState(state: SimulationState): SerializedSimulationState {
  return {
    version: 1,
    tick: state.tick,
    scenarioId: state.scenarioId,
    seed: state.seed,
    randomnessMode: state.randomnessMode,
    randomness: {
      mode: state.randomnessMode,
      runId: state.randomnessMeta.runId,
      rootSeed: state.randomnessMeta.rootSeed,
    },
    world: serializeWorld(state.world),
    agents: state.agents.map(serializeAgent),
    houses: state.houses.map(serializeHouse),
    city: state.city ? serializeCity(state.city) : null,
    rng: state.randomnessMode === 'deterministic' ? serializeRng(state) : null,
    stageCounts: { ...state.stageCounts },
    nextAgentId: state.nextAgentId,
    nextHouseId: state.nextHouseId,
    reproductiveGroups: state.reproductiveGroups.map((group) => serializeReproductiveGroup(group)),
    nextReproductiveGroupId: state.nextReproductiveGroupId,
    chromosomes: cloneChromosomeRegistry(state.chromosomeRegistry),
    leadership: serializeLeadership(state.leadership),
    housing: serializeHouseCapacityController(state.housing),
    pendingHouseAssignments: [...state.pendingHouseAssignments],
  };
}

export async function saveSimulationState(id: string, state: SimulationState): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const record: PersistedSnapshotRecord = {
    id,
    savedAt: Date.now(),
    tick: state.tick,
    scenarioId: state.scenarioId,
    snapshot: createSnapshot(state),
    state: serializeSimulationState(state),
  };
  await requestAsPromise(store.put(record));
  await transactionComplete(tx);
  db.close();
}

function serializeWorld(world: WorldState): SerializedWorldState {
  return {
    width: world.width,
    height: world.height,
    centerX: world.centerX,
    centerY: world.centerY,
    climateSeed: world.climateSeed,
    terrain: {
      width: world.terrain.width,
      height: world.terrain.height,
      tiles: [...world.terrain.tiles],
    },
    resources: serializeWorldResources(world.resources),
  };
}

function serializeWorldResources(layers: WorldState['resources']): SerializedWorldResources {
  const stocks: SerializedWorldResources['stocks'] = {} as SerializedWorldResources['stocks'];
  const capacities: SerializedWorldResources['capacities'] = {} as SerializedWorldResources['capacities'];
  const regenRates: SerializedWorldResources['regenRates'] = {} as SerializedWorldResources['regenRates'];
  const depletion: SerializedWorldResources['depletion'] = {} as SerializedWorldResources['depletion'];

  for (const type of RESOURCE_TYPES) {
    stocks[type] = Array.from(layers.stocks[type]);
    capacities[type] = Array.from(layers.capacities[type]);
    regenRates[type] = Array.from(layers.regenRates[type]);
    depletion[type] = Array.from(layers.depletion[type]);
  }

  return { stocks, capacities, regenRates, depletion };
}

function serializeAgent(agent: AgentState): SerializedAgentState {
  return {
    id: agent.id,
    x: agent.x,
    y: agent.y,
    lifeStage: agent.lifeStage,
    ageTicks: agent.ageTicks,
    speed: agent.speed,
    homeX: agent.homeX,
    homeY: agent.homeY,
    caregiverId: agent.caregiverId,
    explorationBias: agent.explorationBias,
    brain: serializeBrainState(agent.brain),
    brainMultipliers: cloneBrainMultipliers(agent.brainMultipliers),
    brainNodeDuration: agent.brainNodeDuration,
    brainDecision: cloneBrainDecision(agent.brainDecision),
    chromosomes: cloneAgentChromosomes(agent.chromosomes),
    reproductiveRoles: [...agent.reproductiveRoles],
    genderIdentity: agent.genderIdentity,
    fertility: agent.fertility,
    pregnancy: agent.pregnancy ? { ...agent.pregnancy, fetusTemperament: { ...agent.pregnancy.fetusTemperament } } : null,
    bondPartnerId: agent.bondPartnerId,
    reproductiveGroupId: agent.reproductiveGroupId,
    reproductiveGroupRole: agent.reproductiveGroupRole,
    parents: [...agent.parents],
    temperament: { ...agent.temperament },
    traitFlags: [...agent.traitFlags],
    moods: { ...agent.moods },
    houseId: agent.houseId ?? null,
    carriedResources: cloneBundle(agent.carriedResources),
    resourceActivity: cloneAgentResourceActivity(agent.resourceActivity),
    movement: serializeMovementState(agent.movement),
  };
}

function serializeMovementState(state: MovementState): SerializedMovementState {
  return {
    behaviorId: state.behaviorId,
    target: state.target ? { x: state.target.x, y: state.target.y } : null,
    waypoints: state.waypoints ? state.waypoints.map((point) => ({ x: point.x, y: point.y })) : null,
    waypointIndex: state.waypointIndex,
    timer: state.timer,
    lingerTicks: state.lingerTicks,
    data: { ...state.data },
    sameNodeId: state.sameNodeId,
    sameNodeTicks: state.sameNodeTicks,
    sameNodeLimit: state.sameNodeLimit,
  };
}

function serializeReproductiveGroup(group: SimulationState['reproductiveGroups'][number]): SerializedReproductiveGroup {
  return {
    id: group.id,
    formedAtTick: group.formedAtTick,
    members: group.members.map((member) => ({ agentId: member.agentId, role: member.role })),
  };
}

function serializeHouse(house: HouseState): SerializedHouseState {
  return {
    id: house.id,
    x: house.x,
    y: house.y,
    radius: house.radius,
    maxMembers: house.maxMembers,
    preferredMembers: house.preferredMembers,
    capacityPressure: house.capacityPressure,
    archetypeId: house.archetypeId,
    brain: serializeBrainState(house.brain),
    brainNodeDuration: house.brainNodeDuration,
    brainDecision: cloneBrainDecision(house.brainDecision),
    members: [...house.members],
    activeDemand: { ...house.activeDemand },
    stockpiles: cloneBundle(house.stockpiles),
    resourceNeeds: cloneBundle(house.resourceNeeds),
    construction: {
      active: Boolean(house.construction?.active),
      progress: house.construction?.progress ?? 0,
      required: house.construction?.required ?? HOUSE_CONSTRUCTION_COST,
      cooldownUntil: house.construction?.cooldownUntil ?? 0,
    },
    primaryLeaderId: house.primaryLeaderId,
    leaders: house.leaders.map((leader) => cloneLeaderDescriptor(leader)),
    leaderDirectives: { ...house.leaderDirectives },
  };
}

function serializeCity(city: CityState): SerializedCityState {
  return {
    id: city.id,
    x: city.x,
    y: city.y,
    radius: city.radius,
    brain: serializeBrainState(city.brain),
    brainNodeDuration: city.brainNodeDuration,
    brainDecision: cloneBrainDecision(city.brainDecision),
    activeDemand: { ...city.activeDemand },
    demandExpiresAt: city.demandExpiresAt,
    stockpiles: cloneBundle(city.stockpiles),
    resourceNeeds: cloneBundle(city.resourceNeeds),
    primaryLeaderId: city.primaryLeaderId,
    leaders: city.leaders.map((leader) => cloneLeaderDescriptor(leader)),
    leaderDirectives: { ...city.leaderDirectives },
  };
}

function serializeLeadership(source: SimulationState['leadership']): SerializedLeadershipState {
  const houses: Record<string, CollectiveLeaderDescriptor[]> = {};
  for (const [houseId, leaders] of Object.entries(source.houses ?? {})) {
    houses[houseId] = Array.isArray(leaders)
      ? leaders.map((leader) => cloneLeaderDescriptor(leader))
      : [];
  }
  return {
    houses,
    city: Array.isArray(source.city)
      ? source.city.map((leader) => cloneLeaderDescriptor(leader))
      : [],
    updatedAtTick: source.updatedAtTick ?? 0,
  };
}

function cloneAgentResourceActivity(
  activity: AgentState['resourceActivity'],
): AgentState['resourceActivity'] {
  if (!activity) {
    return null;
  }

  const harvested = activity.harvested ? cloneBundle(activity.harvested) : undefined;
  const delivered = activity.delivered ? cloneBundle(activity.delivered) : undefined;
  const hasHarvested = harvested ? RESOURCE_TYPES.some((type) => harvested[type] > 0) : false;
  const hasDelivered = delivered ? RESOURCE_TYPES.some((type) => delivered[type] > 0) : false;

  if (!hasHarvested && !hasDelivered) {
    return null;
  }

  const clone: AgentState['resourceActivity'] = {};
  if (hasHarvested && harvested) {
    clone.harvested = harvested;
  }
  if (hasDelivered && delivered) {
    clone.delivered = delivered;
  }
  return clone;
}

function serializeRng(state: SimulationState): SerializedSimulationRng {
  return {
    root: state.rng.root.serialize(),
    streams: {
      world: state.rng.world.serialize(),
      agentSpawn: state.rng.agentSpawn.serialize(),
      tick: state.rng.tick.serialize(),
      collectives: state.rng.collectives.serialize(),
    },
  };
}

function cloneBrainMultipliers(multipliers: AgentState['brainMultipliers']): AgentState['brainMultipliers'] {
  const clone: AgentState['brainMultipliers'] = {};
  if (multipliers.mood) {
    clone.mood = { ...multipliers.mood };
  }
  if (multipliers.personality) {
    clone.personality = { ...multipliers.personality };
  }
  if (multipliers.demand) {
    clone.demand = { ...multipliers.demand };
  }
  return clone;
}

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}
