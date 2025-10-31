import type { MapSelection, SnapshotCity, SnapshotHouse } from './MapView.ts';

type NullableString = string | null;

type SelectionType = MapSelection['type'];

const HOUSE_STROKE = 'rgba(250, 204, 21, 0.9)';
const HOUSE_FILL = 'rgba(250, 204, 21, 0.15)';
const HOUSE_SELECTED_STROKE = '#fbbf24';
const HOUSE_SELECTED_GLOW = 'rgba(251, 191, 36, 0.45)';

const CITY_STROKE = 'rgba(34, 211, 238, 0.9)';
const CITY_FILL = 'rgba(34, 211, 238, 0.12)';
const CITY_SELECTED_STROKE = '#38bdf8';
const CITY_SELECTED_GLOW = 'rgba(56, 189, 248, 0.45)';

interface CollectiveLayerViewport {
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
  tileSize: number;
  offsetX: number;
  offsetY: number;
  worldWidth: number;
  worldHeight: number;
}

interface CollectiveLayerOptions {
  container: HTMLElement;
}

interface CollectiveVisibility {
  dwellings: boolean;
  city: boolean;
}

export class CollectiveLayer {
  private readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;

  private devicePixelRatio = window.devicePixelRatio || 1;

  private tileSize = 8;

  private offsetX = 0;

  private offsetY = 0;

  private worldWidth = 100;

  private worldHeight = 100;

  private dwellings: SnapshotHouse[] = [];

  private city: SnapshotCity | null = null;

  private selectedType: SelectionType = null;

  private selectedId: NullableString = null;

  private readonly visibility: CollectiveVisibility = {
    dwellings: true,
    city: true,
  };

  private needsRedraw = true;

  constructor({ container }: CollectiveLayerOptions) {
    if (!container) {
      throw new Error('CollectiveLayer requires a host container element.');
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'collective-layer';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      imageRendering: 'pixelated',
      zIndex: '3',
    });

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to acquire 2D context for CollectiveLayer.');
    }

    this.ctx = context;
    container.appendChild(this.canvas);
  }

  updateViewport(viewport: CollectiveLayerViewport) {
    this.devicePixelRatio = viewport.devicePixelRatio || 1;
    this.tileSize = viewport.tileSize;
    this.offsetX = viewport.offsetX;
    this.offsetY = viewport.offsetY;
    this.worldWidth = viewport.worldWidth;
    this.worldHeight = viewport.worldHeight;

    const pixelWidth = Math.max(1, Math.floor(viewport.displayWidth));
    const pixelHeight = Math.max(1, Math.floor(viewport.displayHeight));

    const targetWidth = pixelWidth * this.devicePixelRatio;
    const targetHeight = pixelHeight * this.devicePixelRatio;

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    this.ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    this.needsRedraw = true;
  }

  updateEntities(dwellings: SnapshotHouse[] | null | undefined, city: SnapshotCity | null | undefined) {
    this.dwellings = Array.isArray(dwellings) ? dwellings.slice() : [];
    this.city = city ?? null;
    this.needsRedraw = true;
  }

  setVisibility(layer: keyof CollectiveVisibility, enabled: boolean) {
    if (!(layer in this.visibility)) return;
    const next = Boolean(enabled);
    if (this.visibility[layer] === next) {
      return;
    }
    this.visibility[layer] = next;
    this.needsRedraw = true;
  }

  isVisible(layer: keyof CollectiveVisibility) {
    return this.visibility[layer];
  }

  setSelection(selection: MapSelection | null) {
    const type = selection?.type ?? null;
    const id = selection?.id ?? null;
    if (this.selectedType === type && this.selectedId === id) {
      return;
    }
    this.selectedType = type;
    this.selectedId = id;
    this.needsRedraw = true;
  }

  render() {
    if (!this.needsRedraw) {
      return;
    }

    const ctx = this.ctx;
    const width = this.canvas.width / this.devicePixelRatio;
    const height = this.canvas.height / this.devicePixelRatio;

    ctx.save();
    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (this.visibility.dwellings) {
      this.drawDwellings();
    }
    if (this.visibility.city) {
      this.drawCity();
    }

    ctx.restore();
    this.needsRedraw = false;
  }

  private drawDwellings() {
    const ctx = this.ctx;
    const baseRadius = Math.max(2, this.tileSize * 0.8);

    for (const dwelling of this.dwellings) {
      if (!dwelling) continue;
      const centerX = this.offsetX + dwelling.x * this.tileSize + this.tileSize / 2;
      const centerY = this.offsetY + dwelling.y * this.tileSize + this.tileSize / 2;

      const sizeFactor = Math.sqrt(Math.max(1, dwelling.radius ?? 1));
      const radius = Math.max(baseRadius, sizeFactor * this.tileSize * 0.45);
      const isSelected = this.selectedType === 'house' && this.selectedId === dwelling.id;

      ctx.beginPath();
      ctx.lineWidth = Math.max(1.5, radius * 0.18);
      ctx.strokeStyle = isSelected ? HOUSE_SELECTED_STROKE : HOUSE_STROKE;
      ctx.fillStyle = HOUSE_FILL;
      ctx.shadowBlur = isSelected ? Math.max(6, radius * 0.6) : 0;
      ctx.shadowColor = isSelected ? HOUSE_SELECTED_GLOW : 'transparent';
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawCity() {
    if (!this.city) {
      return;
    }

    const ctx = this.ctx;
    const city = this.city;
    const centerX = this.offsetX + city.x * this.tileSize + this.tileSize / 2;
    const centerY = this.offsetY + city.y * this.tileSize + this.tileSize / 2;
    const sizeFactor = Math.sqrt(Math.max(1, city.radius ?? 1));
    const radius = Math.max(this.tileSize * 1.4, sizeFactor * this.tileSize * 0.5);
    const isSelected = this.selectedType === 'city' && (!this.selectedId || this.selectedId === city.id);

    this.ctx.beginPath();
    this.ctx.lineWidth = Math.max(2, radius * 0.14);
    this.ctx.strokeStyle = isSelected ? CITY_SELECTED_STROKE : CITY_STROKE;
    this.ctx.fillStyle = CITY_FILL;
    this.ctx.shadowBlur = isSelected ? Math.max(8, radius * 0.7) : 0;
    this.ctx.shadowColor = isSelected ? CITY_SELECTED_GLOW : 'transparent';
    this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }
}
