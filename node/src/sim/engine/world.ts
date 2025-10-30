import type { RngStream } from './rng.ts';

export type TerrainType = 'town' | 'plains' | 'forest';

export interface TerrainLayer {
  width: number;
  height: number;
  tiles: TerrainType[];
}

export interface WorldState {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  climateSeed: number;
  terrain: TerrainLayer;
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
  for (let y = 0; y < safeHeight; y += 1) {
    for (let x = 0; x < safeWidth; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distanceRatio = Math.min(1, Math.hypot(dx, dy) / maxRadius);
      tiles[y * safeWidth + x] = classifyTerrain(distanceRatio);
    }
  }

  return {
    width: safeWidth,
    height: safeHeight,
    centerX,
    centerY,
    climateSeed: stream.nextFloat(),
    terrain: { width: safeWidth, height: safeHeight, tiles },
  };
}

function classifyTerrain(distanceRatio: number): TerrainType {
  for (const zone of TERRAIN_ZONES) {
    if (distanceRatio <= zone.radius) {
      return zone.type;
    }
  }
  return 'forest';
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

export function clampPosition(world: WorldState, x: number, y: number): { x: number; y: number } {
  const clampedX = Math.max(0, Math.min(world.width - 1e-6, x));
  const clampedY = Math.max(0, Math.min(world.height - 1e-6, y));
  return { x: clampedX, y: clampedY };
}
