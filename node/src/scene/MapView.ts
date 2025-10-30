import { AgentLayer } from './AgentLayer.ts';

const TERRAIN_COLORS: Record<string, string> = {
  town: '#111821',
  plains: '#1f2733',
  plain: '#1f2733',
  forest: '#283840',
};

const TERRAIN_ZONES: Array<{ type: keyof typeof TERRAIN_COLORS; radius: number }> = [
  { type: 'town', radius: 0.18 },
  { type: 'plains', radius: 0.62 },
  { type: 'forest', radius: 1.0 },
];

const DEFAULT_WORLD_SIZE = 100;
const MIN_TILE_SIZE = 4;
const MAX_TILE_SIZE = 10;
const BACKGROUND_COLOR = '#050a12';
const GRID_COLOR = 'rgba(30, 41, 59, 0.45)';
const SELECT_RADIUS_TILES = 1.6;

export type HeatmapLayer = 'influence' | 'density';

export interface SnapshotWorld {
  width?: number;
  height?: number;
  w?: number;
  h?: number;
}

export interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
  lifeStage: 'baby' | 'child' | 'teen' | 'adult';
}

export interface Snapshot {
  type?: string;
  tick?: number;
  world?: SnapshotWorld;
  stats?: Record<string, number>;
  agents?: SnapshotAgent[];
}

export interface MapViewOptions {
  container: HTMLElement;
}

interface HeatmapVisibility {
  influence: boolean;
  density: boolean;
}

interface HeatmapAggregates {
  authority?: number;
  moodIntensities?: {
    trust?: number;
    fear?: number;
    loyalty?: number;
    resentment?: number;
  };
  density?: {
    normalized?: number;
    total?: number;
  };
}

/**
 * MapView renders the world terrain using a pixel-art inspired 2D canvas.
 * It replaces the old Three.js renderer with a lightweight, raster approach
 * that honours viewport resizing and snapshot-driven updates.
 */
export class MapView {
  private readonly container: HTMLElement;

  private readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;

  private worldWidth = DEFAULT_WORLD_SIZE;

  private worldHeight = DEFAULT_WORLD_SIZE;

  private tileSize = 8;

  private offsetX = 0;

  private offsetY = 0;

  private devicePixelRatio = window.devicePixelRatio || 1;

  private latestSnapshot: Snapshot | null = null;

  private needsRedraw = true;

  private rafHandle: number | null = null;

  private terrainTiles: Array<keyof typeof TERRAIN_COLORS> = [];

  private gridVisible = true;

  private readonly heatmapVisibility: HeatmapVisibility = {
    influence: false,
    density: false,
  };

  private heatmapAggregates: HeatmapAggregates | null = null;

  public selectedAgentId: string | null = null;

  private readonly agentLayer: AgentLayer;

  private readonly selectionListeners = new Set<
    (agentId: string | null, agent: SnapshotAgent | null) => void
  >();

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button != null && event.button !== 0) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;

    const worldX = (canvasX - this.offsetX) / this.tileSize;
    const worldY = (canvasY - this.offsetY) / this.tileSize;

    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      return;
    }

    const nearest = this.findNearestAgent(worldX, worldY, SELECT_RADIUS_TILES);
    if (!nearest) {
      return;
    }

    this.setSelectedAgent(nearest.id);
  };

  constructor({ container }: MapViewOptions) {
    if (!container) {
      throw new Error('MapView requires a host container element.');
    }

    this.container = container;
    this.container.innerHTML = '';
    Object.assign(this.container.style, {
      position: 'fixed',
      inset: '0',
      overflow: 'hidden',
      background: BACKGROUND_COLOR,
    });

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    Object.assign(this.canvas.style, {
      width: '100%',
      height: '100%',
      display: 'block',
      imageRendering: 'pixelated',
      position: 'absolute',
      inset: '0',
      zIndex: '1',
    });

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to acquire 2D rendering context for MapView.');
    }

    this.ctx = context;
    this.container.appendChild(this.canvas);

    this.agentLayer = new AgentLayer({ container: this.container });

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);

    this.generateTerrain();
    this.resizeToDisplay();
  }

  /** Resize the canvas to match the viewport and schedule a redraw. */
  resizeToDisplay() {
    const width = this.container.clientWidth || window.innerWidth || this.worldWidth;
    const height = this.container.clientHeight || window.innerHeight || this.worldHeight;

    this.devicePixelRatio = window.devicePixelRatio || 1;
    const displayWidth = Math.max(1, Math.floor(width));
    const displayHeight = Math.max(1, Math.floor(height));

    if (this.canvas.width !== displayWidth * this.devicePixelRatio || this.canvas.height !== displayHeight * this.devicePixelRatio) {
      this.canvas.width = displayWidth * this.devicePixelRatio;
      this.canvas.height = displayHeight * this.devicePixelRatio;
    }

    this.ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);

    const maxTileWidth = displayWidth / this.worldWidth;
    const maxTileHeight = displayHeight / this.worldHeight;
    const computedTileSize = Math.floor(Math.min(maxTileWidth, maxTileHeight));
    const safeTileSize = Math.max(
      MIN_TILE_SIZE,
      Math.min(MAX_TILE_SIZE, computedTileSize || this.tileSize || 8),
    );

    this.tileSize = safeTileSize;
    const mapPixelWidth = this.worldWidth * this.tileSize;
    const mapPixelHeight = this.worldHeight * this.tileSize;

    this.offsetX = Math.floor((displayWidth - mapPixelWidth) / 2);
    this.offsetY = Math.floor((displayHeight - mapPixelHeight) / 2);

    this.agentLayer.updateViewport({
      displayWidth,
      displayHeight,
      devicePixelRatio: this.devicePixelRatio,
      tileSize: this.tileSize,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
    });

    this.needsRedraw = true;
    this.requestDraw();
  }

  /** Persist the latest snapshot and redraw if necessary. */
  updateFromSnapshot(snapshot: Snapshot | null | undefined) {
    if (!snapshot || snapshot.type !== 'SNAPSHOT') {
      return;
    }

    this.latestSnapshot = snapshot;

    this.agentLayer.updateAgents(snapshot.tick ?? null, snapshot.agents ?? []);

    if (this.selectedAgentId) {
      const stillExists = (snapshot.agents ?? []).some(
        (agent) => agent?.id === this.selectedAgentId,
      );
      if (!stillExists) {
        this.setSelectedAgent(null);
      }
    }

    const worldWidth = this.extractDimension(snapshot.world?.width, snapshot.world?.w);
    const worldHeight = this.extractDimension(snapshot.world?.height, snapshot.world?.h);

    let worldChanged = false;
    if (worldWidth && worldWidth !== this.worldWidth) {
      this.worldWidth = worldWidth;
      worldChanged = true;
    }
    if (worldHeight && worldHeight !== this.worldHeight) {
      this.worldHeight = worldHeight;
      worldChanged = true;
    }

    if (worldChanged) {
      this.generateTerrain();
      this.resizeToDisplay();
    } else {
      this.needsRedraw = true;
      this.requestDraw();
    }

    this.updateHeatmapAggregates(snapshot);
  }

  /** Enable or disable the pixel grid overlay. */
  setGridVisible(visible: boolean) {
    const next = Boolean(visible);
    if (this.gridVisible === next) return;
    this.gridVisible = next;
    this.needsRedraw = true;
    this.requestDraw();
  }

  /** Query whether the pixel grid is currently drawn. */
  isGridVisible() {
    return this.gridVisible;
  }

  /** Forward compatibility with HUD agent selection controls. */
  setSelectedAgent(agentId: string | null) {
    const nextId = agentId ?? null;
    if (this.selectedAgentId === nextId) {
      return;
    }

    this.selectedAgentId = nextId;
    this.agentLayer.setSelectedAgent(this.selectedAgentId);
    this.agentLayer.render();
    this.emitSelectionChange();
  }

  onSelectedAgentChange(
    listener: (agentId: string | null, agent: SnapshotAgent | null) => void,
  ) {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  /** Update aggregated heatmap stats and schedule redraw. */
  setHeatmapAggregates(stats: HeatmapAggregates | null | undefined) {
    this.heatmapAggregates = stats ?? null;
    this.needsRedraw = true;
    this.requestDraw();
  }

  /** Hook for HUD toggles controlling overlay visibility. */
  setHeatmapLayerEnabled(layer: HeatmapLayer, enabled: boolean) {
    if (!(layer in this.heatmapVisibility)) return;
    const next = Boolean(enabled);
    if (this.heatmapVisibility[layer] === next) return;
    this.heatmapVisibility[layer] = next;
    this.needsRedraw = true;
    this.requestDraw();
  }

  isHeatmapLayerEnabled(layer: HeatmapLayer) {
    return this.heatmapVisibility[layer] ?? false;
  }

  private extractDimension(primary?: number, fallback?: number) {
    const value = typeof primary === 'number' ? primary : typeof fallback === 'number' ? fallback : null;
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    const rounded = Math.max(1, Math.floor(value));
    return rounded;
  }

  private requestDraw() {
    if (!this.needsRedraw) return;
    if (this.rafHandle != null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      if (!this.needsRedraw) return;
      this.draw();
      this.needsRedraw = false;
    });
  }

  private draw() {
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;

    this.ctx.save();
    this.ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, width, height);

    this.drawTerrain();
    this.drawHeatmapOverlays();
    if (this.gridVisible) {
      this.drawGridLines();
    }
    this.ctx.restore();

    this.agentLayer.render();
  }

  private drawTerrain() {
    const ctx = this.ctx;
    const mapWidth = this.worldWidth;
    const mapHeight = this.worldHeight;
    const tileSize = this.tileSize;

    for (let y = 0; y < mapHeight; y += 1) {
      for (let x = 0; x < mapWidth; x += 1) {
        const index = y * mapWidth + x;
        const terrain = this.terrainTiles[index] ?? 'forest';
        const color = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS.forest;
        ctx.fillStyle = color;
        const px = this.offsetX + x * tileSize;
        const py = this.offsetY + y * tileSize;
        ctx.fillRect(px, py, tileSize + 1, tileSize + 1);
      }
    }
  }

  private drawGridLines() {
    const ctx = this.ctx;
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();

    const mapWidth = this.worldWidth;
    const mapHeight = this.worldHeight;
    const tileSize = this.tileSize;
    const right = this.offsetX + mapWidth * tileSize;
    const bottom = this.offsetY + mapHeight * tileSize;

    for (let x = 0; x <= mapWidth; x += 1) {
      const px = this.offsetX + x * tileSize + 0.5;
      ctx.moveTo(px, this.offsetY);
      ctx.lineTo(px, bottom);
    }

    for (let y = 0; y <= mapHeight; y += 1) {
      const py = this.offsetY + y * tileSize + 0.5;
      ctx.moveTo(this.offsetX, py);
      ctx.lineTo(right, py);
    }

    ctx.stroke();
  }

  private drawHeatmapOverlays() {
    if (!this.heatmapAggregates) return;

    if (this.heatmapVisibility.influence) {
      const authority = this.clamp01(this.heatmapAggregates.authority ?? 0);
      const mood = this.heatmapAggregates.moodIntensities ?? {};
      const trust = this.clamp01(mood.trust ?? 0);
      const fear = this.clamp01(mood.fear ?? 0);
      const loyalty = this.clamp01(mood.loyalty ?? 0);
      const resentment = this.clamp01(mood.resentment ?? 0);
      const intensity = Math.max(authority, trust, fear, loyalty, resentment);
      if (intensity > 0) {
        const overlayAlpha = 0.2 + intensity * 0.3;
        this.ctx.fillStyle = `rgba(56, 189, 248, ${overlayAlpha.toFixed(3)})`;
        this.ctx.fillRect(
          this.offsetX,
          this.offsetY,
          this.worldWidth * this.tileSize,
          this.worldHeight * this.tileSize,
        );
      }
    }

    if (this.heatmapVisibility.density) {
      const normalized = this.clamp01(this.heatmapAggregates.density?.normalized ?? 0);
      if (normalized > 0) {
        const overlayAlpha = 0.15 + normalized * 0.35;
        this.ctx.fillStyle = `rgba(248, 113, 113, ${overlayAlpha.toFixed(3)})`;
        this.ctx.fillRect(
          this.offsetX,
          this.offsetY,
          this.worldWidth * this.tileSize,
          this.worldHeight * this.tileSize,
        );
      }
    }
  }

  private clamp01(value: number) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  private generateTerrain() {
    const tiles: Array<keyof typeof TERRAIN_COLORS> = new Array(this.worldWidth * this.worldHeight);
    const centerX = (this.worldWidth - 1) / 2;
    const centerY = (this.worldHeight - 1) / 2;
    const maxRadius = Math.hypot(centerX, centerY) || 1;

    for (let y = 0; y < this.worldHeight; y += 1) {
      for (let x = 0; x < this.worldWidth; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.hypot(dx, dy) / maxRadius;
        tiles[y * this.worldWidth + x] = this.classifyTerrain(distance);
      }
    }

    this.terrainTiles = tiles;
    this.needsRedraw = true;
    this.requestDraw();
  }

  private classifyTerrain(distanceRatio: number): keyof typeof TERRAIN_COLORS {
    for (const zone of TERRAIN_ZONES) {
      if (distanceRatio <= zone.radius) {
        return zone.type;
      }
    }
    return 'forest';
  }

  private updateHeatmapAggregates(snapshot: Snapshot) {
    const counts = snapshot.stats ?? {};
    const baby = counts.baby ?? 0;
    const child = counts.child ?? 0;
    const teen = counts.teen ?? 0;
    const adult = counts.adult ?? 0;
    const total = baby + child + teen + adult;

    const totalSafe = total > 0 ? total : 1;
    const area = Math.max(1, this.worldWidth * this.worldHeight);

    const authority = total > 0 ? adult / totalSafe : 0;
    const trust = total > 0 ? child / totalSafe : 0;
    const fear = total > 0 ? teen / totalSafe : 0;
    const loyalty = total > 0 ? Math.min(1, adult / totalSafe + teen / (totalSafe * 2)) : 0;
    const resentment = total > 0 ? Math.min(1, (teen / totalSafe) * 0.6 + (baby / totalSafe) * 0.2) : 0;

    const rawDensity = total / area;
    const normalizedDensity = Math.min(1, rawDensity * 10);

    const aggregates: HeatmapAggregates = {
      authority,
      moodIntensities: {
        trust,
        fear,
        loyalty,
        resentment,
      },
      density: {
        normalized: normalizedDensity,
        total,
      },
    };

    this.setHeatmapAggregates(aggregates);
  }

  private emitSelectionChange() {
    const agent = this.selectedAgentId ? this.findAgentById(this.selectedAgentId) : null;
    for (const listener of this.selectionListeners) {
      listener(this.selectedAgentId, agent);
    }
  }

  private findAgentById(agentId: string | null) {
    if (!agentId || !this.latestSnapshot?.agents) {
      return null;
    }
    for (const agent of this.latestSnapshot.agents) {
      if (agent?.id === agentId) {
        return agent;
      }
    }
    return null;
  }

  private findNearestAgent(x: number, y: number, maxDistanceTiles: number) {
    if (!this.latestSnapshot?.agents || this.latestSnapshot.agents.length === 0) {
      return null;
    }

    const maxDistanceSq = maxDistanceTiles * maxDistanceTiles;
    let closest: SnapshotAgent | null = null;
    let closestDistanceSq = maxDistanceSq;

    for (const agent of this.latestSnapshot.agents) {
      if (!agent) continue;
      const ax = Number.isFinite(agent.x) ? Number(agent.x) : 0;
      const ay = Number.isFinite(agent.y) ? Number(agent.y) : 0;
      const dx = ax - x;
      const dy = ay - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closest = agent;
      }
    }

    return closest;
  }
}
