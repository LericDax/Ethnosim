/**
 * Builds the terrain grid as described in §3.2 of AGENTS.md.
 * "town" at the center, plains ring, forests beyond.
 */
export function initWorld(width = 100, height = 100) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  const tiles = new Array(h);
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      let terrain;
      if (dist < 10) {
        terrain = 'town';
      } else if (dist <= 30) {
        terrain = 'plain';
      } else {
        terrain = 'forest';
      }
      row[x] = terrain;
    }
    tiles[y] = row;
  }

  return {
    w,
    h,
    cx,
    cy,
    tiles,
  };
}

/**
 * Helper to retrieve the terrain string at the given coordinates.
 * @param {{w:number,h:number,tiles:string[][]}} world
 * @param {number} x
 * @param {number} y
 */
export function getTerrain(world, x, y) {
  const ix = Math.min(world.w - 1, Math.max(0, x | 0));
  const iy = Math.min(world.h - 1, Math.max(0, y | 0));
  return world.tiles[iy][ix];
}
