import type { RngStream } from './rng.ts';
import { RESOURCE_TYPES, type ResourceType } from './resources.ts';

export type TerrainType = 'town' | 'plains' | 'forest';

export interface TerrainLayer {
  width: number;
  height: number;
  tiles: TerrainType[];
}

export interface WorldResourceLayers {
  stocks: Record<ResourceType, Float32Array>;
  capacities: Record<ResourceType, Float32Array>;
  regenRates: Record<ResourceType, Float32Array>;
  depletion: Record<ResourceType, Float32Array>;
}

export interface WorldState {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  climateSeed: number;
  terrain: TerrainLayer;
  resources: WorldResourceLayers;
  /**
   * @deprecated Use {@link WorldState.resources.stocks.wood} instead. This view is
   * retained for backwards compatibility with older save formats and tests.
   */
  forestResources: Float32Array;
}

export function createForestResourceAlias(source: Float32Array): Float32Array {
  return new Float32Array(source.buffer, source.byteOffset, source.length);
}

export function syncForestResourceAlias(world: WorldState): void {
  const woodStocks = world.resources.stocks.wood;
  const alias = world.forestResources;
  if (
    alias.buffer !== woodStocks.buffer ||
    alias.byteOffset !== woodStocks.byteOffset ||
    alias.length !== woodStocks.length
  ) {
    world.forestResources = createForestResourceAlias(woodStocks);
  }
}

const TERRAIN_ZONES: Array<{ type: TerrainType; radius: number }> = [
  { type: 'town', radius: 0.18 },
  { type: 'plains', radius: 0.62 },
  { type: 'forest', radius: 1.0 },
];

export function createWorld(width: number, height: number, stream: RngStream): WorldState {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const centerX = (safeWidth - 1) / 2;
  const centerY = (safeHeight - 1) / 2;
  const maxRadius = Math.hypot(centerX, centerY) || 1;

  const tiles: TerrainType[] = new Array<TerrainType>(safeWidth * safeHeight);
  const tileCount = safeWidth * safeHeight;
  const stocks: Record<ResourceType, Float32Array> = {} as Record<ResourceType, Float32Array>;
  const capacities: Record<ResourceType, Float32Array> = {} as Record<ResourceType, Float32Array>;
  const regenRates: Record<ResourceType, Float32Array> = {} as Record<ResourceType, Float32Array>;
  const depletion: Record<ResourceType, Float32Array> = {} as Record<ResourceType, Float32Array>;

  for (const type of RESOURCE_TYPES) {
    stocks[type] = new Float32Array(tileCount);
    capacities[type] = new Float32Array(tileCount);
    regenRates[type] = new Float32Array(tileCount);
    depletion[type] = new Float32Array(tileCount);
  }

  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distanceRatio = Math.min(1, Math.hypot(dx, dy) / maxRadius);
      const terrain = classifyTerrain(distanceRatio);
      const index = y * safeWidth + x;
      tiles[index] = terrain;
      const profile = buildTileResourceProfile(terrain, distanceRatio, stream);
      for (const type of RESOURCE_TYPES) {
        capacities[type][index] = profile[type].capacity;
        regenRates[type][index] = profile[type].regen;
        stocks[type][index] = profile[type].capacity * profile[type].fill;
        depletion[type][index] = 0;
      }
    }
  }

  const resources: WorldResourceLayers = { stocks, capacities, regenRates, depletion };

  const world: WorldState = {
    width: safeWidth,
    height: safeHeight,
    centerX,
    centerY,
    climateSeed: stream.nextFloat(),
    terrain: { width: safeWidth, height: safeHeight, tiles },
    resources,
    forestResources: createForestResourceAlias(stocks.wood),
  };

  return world;
}

function classifyTerrain(distanceRatio: number): TerrainType {
  for (const zone of TERRAIN_ZONES) {
    if (distanceRatio <= zone.radius) {
      return zone.type;
    }
  }
  return 'forest';
}

interface TileResourceProfile {
  capacity: number;
  regen: number;
  fill: number;
}

type TileResourceProfileMap = Record<ResourceType, TileResourceProfile>;

function buildTileResourceProfile(
  terrain: TerrainType,
  distanceRatio: number,
  stream: RngStream,
): TileResourceProfileMap {
  const base: TileResourceProfileMap = {
    wood: { capacity: 0, regen: 0, fill: 0 },
    forage: { capacity: 0, regen: 0, fill: 0 },
    ore: { capacity: 0, regen: 0, fill: 0 },
  };

  if (terrain === 'forest') {
    const woodCapacity = 10 + stream.nextFloat() * 6;
    base.wood.capacity = woodCapacity;
    base.wood.regen = 0.45 + stream.nextFloat() * 0.4;
    base.wood.fill = 0.55 + stream.nextFloat() * 0.35;

    const forageCapacity = 4.5 + stream.nextFloat() * 3.5;
    base.forage.capacity = forageCapacity;
    base.forage.regen = 0.22 + stream.nextFloat() * 0.18;
    base.forage.fill = 0.5 + stream.nextFloat() * 0.4;

    const oreChance = 0.2 - distanceRatio * 0.05;
    if (stream.nextFloat() < oreChance) {
      const oreCapacity = 6 + stream.nextFloat() * 6;
      base.ore.capacity = oreCapacity;
      base.ore.regen = 0.15 + stream.nextFloat() * 0.12;
      base.ore.fill = 0.45 + stream.nextFloat() * 0.4;
    }
  } else if (terrain === 'plains') {
    const woodCapacity = 1.5 + stream.nextFloat() * 2.5;
    base.wood.capacity = woodCapacity;
    base.wood.regen = 0.12 + stream.nextFloat() * 0.18;
    base.wood.fill = 0.4 + stream.nextFloat() * 0.4;

    const forageCapacity = 6 + stream.nextFloat() * 6;
    base.forage.capacity = forageCapacity;
    base.forage.regen = 0.3 + stream.nextFloat() * 0.35;
    base.forage.fill = 0.55 + stream.nextFloat() * 0.35;

    const oreChance = 0.08 - distanceRatio * 0.02;
    if (stream.nextFloat() < oreChance) {
      const oreCapacity = 4 + stream.nextFloat() * 4;
      base.ore.capacity = oreCapacity;
      base.ore.regen = 0.12 + stream.nextFloat() * 0.1;
      base.ore.fill = 0.4 + stream.nextFloat() * 0.35;
    }
  } else {
    const woodCapacity = 0.6 + stream.nextFloat() * 1.4;
    base.wood.capacity = woodCapacity;
    base.wood.regen = 0.08 + stream.nextFloat() * 0.12;
    base.wood.fill = 0.35 + stream.nextFloat() * 0.4;

    const forageCapacity = 1.2 + stream.nextFloat() * 2.2;
    base.forage.capacity = forageCapacity;
    base.forage.regen = 0.1 + stream.nextFloat() * 0.15;
    base.forage.fill = 0.3 + stream.nextFloat() * 0.35;

    const oreChance = 0.04;
    if (stream.nextFloat() < oreChance) {
      const oreCapacity = 3 + stream.nextFloat() * 3;
      base.ore.capacity = oreCapacity;
      base.ore.regen = 0.08 + stream.nextFloat() * 0.08;
      base.ore.fill = 0.35 + stream.nextFloat() * 0.4;
    }
  }

  for (const type of RESOURCE_TYPES) {
    const profile = base[type];
    if (profile.capacity <= 0 || profile.regen <= 0) {
      profile.capacity = 0;
      profile.regen = 0;
      profile.fill = 0;
    } else {
      profile.fill = Math.min(1, Math.max(0.2, profile.fill));
    }
  }

  return base;
}

export function isWithinBounds(world: WorldState, x: number, y: number): boolean {
  return x >= 0 && x < world.width && y >= 0 && y < world.height;
}

export function getTerrainAt(world: WorldState, x: number, y: number): TerrainType | null {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (!isWithinBounds(world, tileX, tileY)) {
    return null;
  }
  const index = tileY * world.width + tileX;
  return world.terrain.tiles[index];
}

export function isTerrainType(world: WorldState, x: number, y: number, type: TerrainType): boolean {
  return getTerrainAt(world, x, y) === type;
}

export function isTownTile(world: WorldState, x: number, y: number): boolean {
  return isTerrainType(world, x, y, 'town');
}

export function isPlainsTile(world: WorldState, x: number, y: number): boolean {
  return isTerrainType(world, x, y, 'plains');
}

export function isForestTile(world: WorldState, x: number, y: number): boolean {
  return isTerrainType(world, x, y, 'forest');
}

export function getResourceStock(
  world: WorldState,
  type: ResourceType,
  x: number,
  y: number,
): number {
  const index = resolveTileIndex(world, x, y);
  if (index < 0) {
    return 0;
  }
  return world.resources.stocks[type][index] ?? 0;
}

export function harvestResource(
  world: WorldState,
  type: ResourceType,
  x: number,
  y: number,
  amount: number,
): number {
  const index = resolveTileIndex(world, x, y);
  if (amount <= 0 || index < 0) {
    return 0;
  }
  const stocks = world.resources.stocks[type];
  const available = stocks[index] ?? 0;
  if (available <= 0) {
    return 0;
  }
  const harvested = Math.min(available, amount);
  stocks[index] = available - harvested;

  const capacity = world.resources.capacities[type][index] ?? 0;
  if (capacity > 0) {
    const delta = harvested / capacity;
    const depletion = world.resources.depletion[type];
    const penalty = delta * 0.65 + (stocks[index] <= capacity * 0.1 ? 0.1 : 0);
    depletion[index] = Math.min(1, Math.max(0, (depletion[index] ?? 0) + penalty));
  }

  return harvested;
}

export function addResourceStock(
  world: WorldState,
  type: ResourceType,
  x: number,
  y: number,
  amount: number,
): void {
  const index = resolveTileIndex(world, x, y);
  if (amount <= 0 || index < 0) {
    return;
  }
  const stocks = world.resources.stocks[type];
  const capacity = world.resources.capacities[type][index] ?? 0;
  if (capacity <= 0) {
    stocks[index] = 0;
    world.resources.depletion[type][index] = 0;
    return;
  }
  const next = Math.min(capacity, (stocks[index] ?? 0) + amount);
  stocks[index] = next;

  const replenished = next / capacity;
  const depletion = world.resources.depletion[type];
  depletion[index] = Math.max(0, (depletion[index] ?? 0) - replenished * 0.25);
}

export function tickWorldResources(world: WorldState): void {
  const tileCount = world.width * world.height;
  for (const type of RESOURCE_TYPES) {
    const stocks = world.resources.stocks[type];
    const capacities = world.resources.capacities[type];
    const regenRates = world.resources.regenRates[type];
    const depletion = world.resources.depletion[type];

    for (let i = 0; i < tileCount; i += 1) {
      const capacity = capacities[i];
      if (capacity <= 0) {
        stocks[i] = 0;
        depletion[i] = 0;
        continue;
      }

      const regen = regenRates[i];
      if (regen <= 0) {
        continue;
      }

      const scarcity = Math.min(1, Math.max(0, depletion[i]));
      const regenFactor = 1 - scarcity * 0.75;
      const increment = regen * regenFactor;
      const current = stocks[i];
      stocks[i] = current + increment > capacity ? capacity : current + increment;

      if (stocks[i] >= capacity * 0.95) {
        depletion[i] = Math.max(0, scarcity - 0.08);
      } else {
        const recovery = 0.015 + regenFactor * 0.02;
        depletion[i] = Math.max(0, scarcity - recovery);
      }
    }
  }

  syncForestResourceAlias(world);
}

function resolveTileIndex(world: WorldState, x: number, y: number): number {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (!isWithinBounds(world, tileX, tileY)) {
    return -1;
  }
  return tileY * world.width + tileX;
}

export function clampPosition(world: WorldState, x: number, y: number): { x: number; y: number } {
  const clampedX = Math.max(0, Math.min(world.width - 1e-6, x));
  const clampedY = Math.max(0, Math.min(world.height - 1e-6, y));
  return { x: clampedX, y: clampedY };
}
