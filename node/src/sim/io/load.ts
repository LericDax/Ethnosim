import type { SimulationState, AgentState } from '../sim.worker.ts';
import type { WorldState } from '../engine/world.ts';
import {
  HOUSE_CONSTRUCTION_COST,
  cloneLeaderDescriptor,
  type CityState,
  type CollectiveLeaderDescriptor,
  type HouseState,
  type ResourceBundle,
  type ResourceType,
  restoreHouseCapacityController,
} from '../engine/collectives.ts';
import { restoreModeAwareRngSuite } from '../engine/rng.ts';
import { cloneBrainDecision, restoreBrainState } from '../engine/brain.ts';
import {
  cloneAgentChromosomes,
  cloneChromosomeRegistry,
  buildChromosomeRegistry,
} from '../engine/chromosomes.ts';
import {
  DB_NAME,
  DB_VERSION,
  STORE_NAME,
  type PersistedSnapshotRecord,
  type SerializedAgentState,
  type SerializedCityState,
  type SerializedHouseState,
  type SerializedMovementState,
  type SerializedSimulationState,
  type SerializedWorldState,
  type SerializedReproductiveGroup,
  type SerializedLeadershipState,
} from './save.ts';
import { matchReproductivePartners } from '../engine/repro.ts';
import { getScenarioById } from '../data/scenarios.ts';
import type { ReproductiveGroup } from '../engine/repro.ts';
import { createInitialMovementState } from '../engine/move.ts';

export async function loadSimulationState(id: string): Promise<SimulationState | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const record = (await requestAsPromise(store.get(id))) as PersistedSnapshotRecord | undefined;
  await transactionComplete(tx);
  db.close();

  if (!record) {
    return null;
  }
  return restoreSimulationState(record.state);
}

export function restoreSimulationState(serialized: SerializedSimulationState): SimulationState {
  const randomnessMode = serialized.randomnessMode ?? 'deterministic';
  const rngSuite = restoreModeAwareRngSuite(randomnessMode, serialized.rng);
  const rootRng = rngSuite.root;
  const worldStream = rngSuite.world;
  const agentStream = rngSuite.agentSpawn;
  const tickStream = rngSuite.tick;
  const collectivesStream = rngSuite.collectives;

  const world = restoreWorld(serialized.world);
  const agents = serialized.agents.map((agent) => restoreAgent(agent));
  const houses = serialized.houses.map((house) => restoreHouse(house));
  const city = serialized.city ? restoreCity(serialized.city) : null;
  const scenarioConfig = getScenarioById(serialized.scenarioId);
  const housing = restoreHouseCapacityController(
    (serialized as Partial<SerializedSimulationState>).housing ?? null,
    scenarioConfig.housing ?? null,
  );
  for (const house of houses) {
    if (!house.archetypeId) {
      house.archetypeId = housing.defaultArchetypeId;
    }
  }
  const registrySource = (serialized as Partial<SerializedSimulationState>).chromosomes;
  const chromosomeRegistry = registrySource
    ? cloneChromosomeRegistry(registrySource)
    : buildChromosomeRegistry(null);
  const reproductiveGroups = (serialized as Partial<SerializedSimulationState>).reproductiveGroups
    ? serialized.reproductiveGroups.map((group) => restoreReproductiveGroup(group))
    : [];
  const nextReproductiveGroupId =
    (serialized as Partial<SerializedSimulationState>).nextReproductiveGroupId ??
    inferNextReproductiveGroupId(reproductiveGroups);
  const nextHouseId =
    (serialized as Partial<SerializedSimulationState>).nextHouseId ?? inferNextHouseId(houses);

  const leadership = restoreLeadership(
    (serialized as Partial<SerializedSimulationState>).leadership,
    houses,
    city,
  );

  const simulation: SimulationState = {
    tick: serialized.tick,
    world,
    agents,
    houses,
    city,
    rng: {
      root: rootRng,
      world: worldStream,
      agentSpawn: agentStream,
      tick: tickStream,
      collectives: collectivesStream,
    },
    randomnessMode,
    stageCounts: { ...serialized.stageCounts },
    nextAgentId: serialized.nextAgentId,
    nextHouseId,
    reproductiveGroups,
    nextReproductiveGroupId,
    scenarioId: serialized.scenarioId,
    seed: serialized.seed,
    chromosomeRegistry,
    leadership,
    housing,
    pendingHouseAssignments: sanitizePendingAssignments(
      serialized.pendingHouseAssignments ?? [],
    ),
  };

  matchReproductivePartners(simulation);

  return simulation;
}

function restoreWorld(serialized: SerializedWorldState): WorldState {
  const capacity = Number.isFinite(serialized.forestResourceCapacity)
    ? serialized.forestResourceCapacity
    : 12;
  const totalTiles = serialized.width * serialized.height;
  let forestResources: Float32Array;
  if (Array.isArray(serialized.forestResources) && serialized.forestResources.length === totalTiles) {
    forestResources = new Float32Array(serialized.forestResources);
  } else {
    forestResources = new Float32Array(totalTiles);
    forestResources.fill(capacity * 0.5);
  }
  return {
    width: serialized.width,
    height: serialized.height,
    centerX: serialized.centerX,
    centerY: serialized.centerY,
    climateSeed: serialized.climateSeed,
    terrain: {
      width: serialized.terrain.width,
      height: serialized.terrain.height,
      tiles: [...serialized.terrain.tiles],
    },
    forestResources,
    forestResourceCapacity: capacity,
  };
}

function sanitizePendingAssignments(source: unknown): string[] {
  if (!Array.isArray(source)) {
    return [];
  }
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const entry of source) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    queue.push(trimmed);
  }
  return queue;
}

function restoreAgent(serialized: SerializedAgentState): AgentState {
  const chromosomesSource = (serialized as Partial<SerializedAgentState>).chromosomes;
  let chromosomes: AgentState['chromosomes'];
  if (chromosomesSource) {
    chromosomes = cloneAgentChromosomes(chromosomesSource);
  } else {
    const legacySex = (serialized as { sexBody?: 'male' | 'female' }).sexBody;
    const legacyRoles = legacySex === 'female' ? ['gestator'] : legacySex === 'male' ? ['fertilizer'] : [];
    const legacyLabel = legacySex ?? 'Unknown';
    chromosomes = {
      code: legacyLabel,
      label: legacyLabel,
      roles: legacyRoles,
    };
  }
  const reproductiveRoles = (serialized as Partial<SerializedAgentState>).reproductiveRoles
    ? [...serialized.reproductiveRoles]
    : [...chromosomes.roles];

  return {
    id: serialized.id,
    x: serialized.x,
    y: serialized.y,
    lifeStage: serialized.lifeStage,
    speed: serialized.speed,
    homeX: serialized.homeX,
    homeY: serialized.homeY,
    caregiverId: serialized.caregiverId,
    explorationBias: serialized.explorationBias,
    brain: restoreBrainState(serialized.brain),
    brainMultipliers: cloneBrainMultipliers(serialized.brainMultipliers),
    brainNodeDuration: serialized.brainNodeDuration,
    brainDecision: cloneBrainDecision(serialized.brainDecision),
    ageTicks: serialized.ageTicks,
    chromosomes,
    reproductiveRoles,
    genderIdentity: serialized.genderIdentity,
    fertility: serialized.fertility,
    pregnancy: serialized.pregnancy
      ? { ...serialized.pregnancy, fetusTemperament: { ...serialized.pregnancy.fetusTemperament } }
      : null,
    bondPartnerId: serialized.bondPartnerId,
    reproductiveGroupId: serialized.reproductiveGroupId ?? null,
    reproductiveGroupRole: serialized.reproductiveGroupRole ?? null,
    parents: [...serialized.parents],
    temperament: { ...serialized.temperament },
    traitFlags: [...serialized.traitFlags],
    moods: { ...serialized.moods },
    houseId: serialized.houseId,
    carriedResources: cloneResourceBundle(serialized.carriedResources),
    resourceActivity: cloneAgentResourceActivity(serialized.resourceActivity),
    movement: restoreMovementState(serialized.movement),
  };
}

function restoreMovementState(serialized: SerializedMovementState | undefined): AgentState['movement'] {
  const state = createInitialMovementState();
  if (!serialized) {
    return state;
  }

  state.behaviorId = serialized.behaviorId ?? null;
  state.target = serialized.target ? { x: serialized.target.x, y: serialized.target.y } : null;
  state.waypoints = Array.isArray(serialized.waypoints)
    ? serialized.waypoints.map((point) => ({ x: point.x, y: point.y }))
    : null;
  state.waypointIndex = Number.isFinite(serialized.waypointIndex)
    ? Math.max(0, Math.floor(serialized.waypointIndex))
    : 0;
  state.timer = Number.isFinite(serialized.timer) ? Math.max(0, Math.floor(serialized.timer)) : 0;
  state.lingerTicks = Number.isFinite(serialized.lingerTicks)
    ? Math.max(0, Math.floor(serialized.lingerTicks))
    : 0;
  state.data = serialized.data ? { ...serialized.data } : {};
  state.sameNodeId = serialized.sameNodeId ?? null;
  state.sameNodeTicks = Number.isFinite(serialized.sameNodeTicks)
    ? Math.max(0, Math.floor(serialized.sameNodeTicks))
    : 0;
  if (Number.isFinite(serialized.sameNodeLimit)) {
    state.sameNodeLimit = Math.max(4, Math.floor(serialized.sameNodeLimit));
  }
  return state;
}

function restoreReproductiveGroup(serialized: SerializedReproductiveGroup): ReproductiveGroup {
  return {
    id: serialized.id,
    formedAtTick: serialized.formedAtTick ?? 0,
    members: serialized.members.map((member) => ({ agentId: member.agentId, role: member.role })),
  };
}

function inferNextReproductiveGroupId(groups: ReproductiveGroup[]): number {
  let max = -1;
  for (const group of groups) {
    const match = /^(?:.*?)(\d+)$/.exec(group.id);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max + 1;
}

function inferNextHouseId(houses: HouseState[]): number {
  let max = -1;
  for (const house of houses) {
    const match = /^(?:.*?)(\d+)$/.exec(house.id);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max + 1;
}

function restoreHouse(serialized: SerializedHouseState): HouseState {
  const maxMembers = Number.isFinite(serialized.maxMembers)
    ? Math.max(1, Math.floor(serialized.maxMembers))
    : 1;
  let preferredMembers: number | null = null;
  if (serialized.preferredMembers === null) {
    preferredMembers = null;
  } else if (Number.isFinite(serialized.preferredMembers)) {
    preferredMembers = Math.max(1, Math.min(maxMembers, Math.floor(serialized.preferredMembers)));
  }
  const capacityPressure = Number.isFinite(serialized.capacityPressure)
    ? Math.max(0, Math.floor(serialized.capacityPressure))
    : 0;
  return {
    id: serialized.id,
    x: serialized.x,
    y: serialized.y,
    radius: serialized.radius,
    maxMembers,
    preferredMembers,
    capacityPressure,
    archetypeId: serialized.archetypeId ?? null,
    brain: restoreBrainState(serialized.brain),
    brainNodeDuration: serialized.brainNodeDuration,
    brainDecision: cloneBrainDecision(serialized.brainDecision),
    members: [...serialized.members],
    activeDemand: { ...serialized.activeDemand },
    stockpiles: cloneResourceBundle(serialized.stockpiles),
    construction: restoreHouseConstruction(serialized.construction),
    primaryLeaderId: serialized.primaryLeaderId ?? null,
    leaders: cloneLeadershipDescriptors(serialized.leaders),
    leaderDirectives: cloneDirectiveMap(serialized.leaderDirectives),
  };
}

function restoreCity(serialized: SerializedCityState): CityState {
  return {
    id: serialized.id,
    x: serialized.x,
    y: serialized.y,
    radius: serialized.radius,
    brain: restoreBrainState(serialized.brain),
    brainNodeDuration: serialized.brainNodeDuration,
    brainDecision: cloneBrainDecision(serialized.brainDecision),
    activeDemand: { ...serialized.activeDemand },
    demandExpiresAt: serialized.demandExpiresAt,
    stockpiles: cloneResourceBundle(serialized.stockpiles),
    primaryLeaderId: serialized.primaryLeaderId ?? null,
    leaders: cloneLeadershipDescriptors(serialized.leaders),
    leaderDirectives: cloneDirectiveMap(serialized.leaderDirectives),
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

function cloneLeadershipDescriptors(
  leaders: CollectiveLeaderDescriptor[] | null | undefined,
): CollectiveLeaderDescriptor[] {
  if (!Array.isArray(leaders) || leaders.length === 0) {
    return [];
  }
  return leaders.map((leader) => cloneLeaderDescriptor(leader));
}

function cloneDirectiveMap(source: Record<string, number> | null | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  if (!source) {
    return map;
  }
  for (const [key, value] of Object.entries(source)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    map[key] = numeric;
  }
  return map;
}

function restoreLeadership(
  serialized: SerializedLeadershipState | undefined,
  houses: HouseState[],
  city: CityState | null,
): SimulationState['leadership'] {
  if (serialized) {
    const housesMap: Record<string, CollectiveLeaderDescriptor[]> = {};
    for (const [houseId, leaders] of Object.entries(serialized.houses ?? {})) {
      housesMap[houseId] = cloneLeadershipDescriptors(leaders);
    }
    return {
      houses: housesMap,
      city: cloneLeadershipDescriptors(serialized.city),
      updatedAtTick: serialized.updatedAtTick ?? 0,
    };
  }

  const derivedHouses: Record<string, CollectiveLeaderDescriptor[]> = {};
  for (const house of houses) {
    derivedHouses[house.id] = cloneLeadershipDescriptors(house.leaders);
  }

  return {
    houses: derivedHouses,
    city: city ? cloneLeadershipDescriptors(city.leaders) : [],
    updatedAtTick: 0,
  };
}

function cloneAgentResourceActivity(
  activity: AgentState['resourceActivity'] | null | undefined,
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

function restoreHouseConstruction(
  serialized: SerializedHouseState['construction'] | null | undefined,
): HouseState['construction'] {
  if (!serialized) {
    return {
      active: false,
      progress: 0,
      required: HOUSE_CONSTRUCTION_COST,
      cooldownUntil: 0,
    };
  }
  const progress = Number.isFinite(serialized.progress) ? Math.max(0, serialized.progress) : 0;
  const required = Number.isFinite(serialized.required)
    ? Math.max(1, serialized.required)
    : HOUSE_CONSTRUCTION_COST;
  const cooldown = Number.isFinite(serialized.cooldownUntil) ? serialized.cooldownUntil : 0;
  return {
    active: Boolean(serialized.active),
    progress,
    required,
    cooldownUntil: cooldown,
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
