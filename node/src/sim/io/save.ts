import { createSnapshot, type SimulationState } from '../sim.worker.ts';
import { cloneBrainDecision, serializeBrainState, type SerializedBrainState } from '../engine/brain.ts';
import type { BrainDecision } from '../engine/brain.ts';
import type { SerializedSeededRng, SerializedRngStream } from '../engine/rng.ts';
import type { WorldState } from '../engine/world.ts';
import type { AgentState, PregnancyState } from '../sim.worker.ts';
import {
  HOUSE_CONSTRUCTION_COST,
  type CityState,
  type HouseState,
  type ResourceBundle,
  type ResourceType,
} from '../engine/collectives.ts';
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
  brain: SerializedBrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  members: string[];
  activeDemand: Record<string, number>;
  stockpiles: HouseState['stockpiles'];
  construction: HouseState['construction'];
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
}

export interface SerializedTerrainLayer {
  width: number;
  height: number;
  tiles: WorldState['terrain']['tiles'];
}

export interface SerializedWorldState {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  climateSeed: number;
  terrain: SerializedTerrainLayer;
  forestResources: number[];
  forestResourceCapacity: number;
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

export interface SerializedSimulationState {
  version: number;
  tick: number;
  scenarioId: string;
  seed: string;
  world: SerializedWorldState;
  agents: SerializedAgentState[];
  houses: SerializedHouseState[];
  city: SerializedCityState | null;
  rng: SerializedSimulationRng;
  stageCounts: SimulationState['stageCounts'];
  nextAgentId: number;
  nextHouseId: number;
  reproductiveGroups: SerializedReproductiveGroup[];
  nextReproductiveGroupId: number;
  chromosomes: ChromosomeRegistry;
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
    world: serializeWorld(state.world),
    agents: state.agents.map(serializeAgent),
    houses: state.houses.map(serializeHouse),
    city: state.city ? serializeCity(state.city) : null,
    rng: serializeRng(state),
    stageCounts: { ...state.stageCounts },
    nextAgentId: state.nextAgentId,
    nextHouseId: state.nextHouseId,
    reproductiveGroups: state.reproductiveGroups.map((group) => serializeReproductiveGroup(group)),
    nextReproductiveGroupId: state.nextReproductiveGroupId,
    chromosomes: cloneChromosomeRegistry(state.chromosomeRegistry),
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
    forestResources: Array.from(world.forestResources),
    forestResourceCapacity: world.forestResourceCapacity,
  };
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
    carriedResources: cloneResourceBundle(agent.carriedResources),
    resourceActivity: cloneAgentResourceActivity(agent.resourceActivity),
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
    brain: serializeBrainState(house.brain),
    brainNodeDuration: house.brainNodeDuration,
    brainDecision: cloneBrainDecision(house.brainDecision),
    members: [...house.members],
    activeDemand: { ...house.activeDemand },
    stockpiles: cloneResourceBundle(house.stockpiles),
    construction: {
      active: Boolean(house.construction?.active),
      progress: house.construction?.progress ?? 0,
      required: house.construction?.required ?? HOUSE_CONSTRUCTION_COST,
      cooldownUntil: house.construction?.cooldownUntil ?? 0,
    },
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
    stockpiles: cloneResourceBundle(city.stockpiles),
  };
}

function cloneResourceBundle(bundle: ResourceBundle | null | undefined): ResourceBundle {
  const clone: ResourceBundle = {};
  if (!bundle) {
    return clone;
  }
  for (const [key, value] of Object.entries(bundle)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    clone[key as ResourceType] = Math.max(0, numeric);
  }
  return clone;
}

function cloneAgentResourceActivity(
  activity: AgentState['resourceActivity'],
): AgentState['resourceActivity'] {
  if (!activity) {
    return null;
  }

  const harvested = activity.harvested ? cloneResourceBundle(activity.harvested) : undefined;
  const delivered = activity.delivered ? cloneResourceBundle(activity.delivered) : undefined;
  const hasHarvested = harvested && Object.keys(harvested).length > 0;
  const hasDelivered = delivered && Object.keys(delivered).length > 0;

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
