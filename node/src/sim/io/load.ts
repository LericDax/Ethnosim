import type { SimulationState, AgentState } from '../sim.worker.ts';
import type { WorldState } from '../engine/world.ts';
import type { CityState, HouseState } from '../engine/collectives.ts';
import { restoreSeededRng } from '../engine/rng.ts';
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
  type SerializedSimulationState,
  type SerializedWorldState,
} from './save.ts';

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
  const rootRng = restoreSeededRng(serialized.rng.root);
  const worldStream = rootRng.stream('world');
  worldStream.restore(serialized.rng.streams.world);
  const agentStream = rootRng.stream('agent-spawn');
  agentStream.restore(serialized.rng.streams.agentSpawn);
  const tickStream = rootRng.stream('tick');
  tickStream.restore(serialized.rng.streams.tick);
  const collectivesStream = rootRng.stream('collectives');
  collectivesStream.restore(serialized.rng.streams.collectives);

  const world = restoreWorld(serialized.world);
  const agents = serialized.agents.map((agent) => restoreAgent(agent));
  const houses = serialized.houses.map((house) => restoreHouse(house));
  const city = serialized.city ? restoreCity(serialized.city) : null;
  const registrySource = (serialized as Partial<SerializedSimulationState>).chromosomes;
  const chromosomeRegistry = registrySource
    ? cloneChromosomeRegistry(registrySource)
    : buildChromosomeRegistry(null);

  return {
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
    stageCounts: { ...serialized.stageCounts },
    nextAgentId: serialized.nextAgentId,
    scenarioId: serialized.scenarioId,
    seed: serialized.seed,
    chromosomeRegistry,
  };
}

function restoreWorld(serialized: SerializedWorldState): WorldState {
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
  };
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
    parents: [...serialized.parents],
    temperament: { ...serialized.temperament },
    traitFlags: [...serialized.traitFlags],
    moods: { ...serialized.moods },
    houseId: serialized.houseId,
  };
}

function restoreHouse(serialized: SerializedHouseState): HouseState {
  return {
    id: serialized.id,
    x: serialized.x,
    y: serialized.y,
    radius: serialized.radius,
    brain: restoreBrainState(serialized.brain),
    brainNodeDuration: serialized.brainNodeDuration,
    brainDecision: cloneBrainDecision(serialized.brainDecision),
    members: [...serialized.members],
    activeDemand: { ...serialized.activeDemand },
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
