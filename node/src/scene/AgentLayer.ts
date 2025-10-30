import type { SnapshotAgent } from './MapView.ts';

type AgentLifeStage = SnapshotAgent['lifeStage'];

type NullableNumber = number | null;

type NullableString = string | null;

const LIFE_STAGE_COLORS: Record<AgentLifeStage, string> = {
  baby: '#f472b6',
  child: '#facc15',
  teen: '#22d3ee',
  adult: '#f8fafc',
};

const DEFAULT_AGENT_COLOR = '#e2e8f0';

const MIN_AGENT_SIZE = 6;
const MAX_AGENT_SIZE = 10;

interface AgentLayerViewport {
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
  tileSize: number;
  offsetX: number;
  offsetY: number;
  worldWidth: number;
  worldHeight: number;
}

interface AgentLayerOptions {
  container: HTMLElement;
}

/**
 * AgentLayer renders 2D pixel-scale sprites for agents on top of the terrain map.
 * It operates on its own canvas so that future render backends (e.g. WebGL, 3D)
 * can swap in alternative implementations without changing MapView.
 */
export class AgentLayer {
  private readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;

  private devicePixelRatio = window.devicePixelRatio || 1;

  private tileSize = 8;

  private offsetX = 0;

  private offsetY = 0;

  private worldWidth = 100;

  private worldHeight = 100;

  private latestTick: NullableNumber = null;

  private agents: SnapshotAgent[] = [];

  private selectedAgentId: NullableString = null;

  private needsRedraw = true;

  constructor({ container }: AgentLayerOptions) {
    if (!container) {
      throw new Error('AgentLayer requires a host container element.');
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'agent-layer';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      imageRendering: 'pixelated',
      zIndex: '2',
    });

    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to acquire 2D context for AgentLayer.');
    }

    this.ctx = context;
    container.appendChild(this.canvas);
  }

  updateViewport(viewport: AgentLayerViewport) {
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

  updateAgents(tick: number | null | undefined, agents: SnapshotAgent[] | null | undefined) {
    const normalizedTick: NullableNumber = Number.isFinite(tick as number) ? Number(tick) : null;

    // Only schedule a redraw if we have not rendered this tick yet.
    if (normalizedTick != null && this.latestTick === normalizedTick && !this.needsRedraw) {
      this.agents = Array.isArray(agents) ? agents.slice() : [];
      return;
    }

    this.latestTick = normalizedTick;
    this.agents = Array.isArray(agents) ? agents.slice() : [];
    this.needsRedraw = true;
  }

  setSelectedAgent(agentId: string | null) {
    const nextId: NullableString = agentId ?? null;
    if (this.selectedAgentId === nextId) {
      return;
    }
    this.selectedAgentId = nextId;
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

    const minSize = Math.min(MIN_AGENT_SIZE, Math.max(2, this.tileSize - 1));
    const idealSize = Math.floor(this.tileSize * 0.7);
    const baseSize = Math.min(MAX_AGENT_SIZE, Math.max(minSize, idealSize));
    const radius = baseSize / 2;

    for (const agent of this.agents) {
      if (!agent || !agent.id) continue;
      const ax = Number.isFinite(agent.x) ? Number(agent.x) : 0;
      const ay = Number.isFinite(agent.y) ? Number(agent.y) : 0;

      const cx = this.offsetX + ax * this.tileSize + this.tileSize / 2;
      const cy = this.offsetY + ay * this.tileSize + this.tileSize / 2;

      const lifeStage = agent.lifeStage ?? 'adult';
      const fill = LIFE_STAGE_COLORS[lifeStage as AgentLifeStage] ?? DEFAULT_AGENT_COLOR;
      const isSelected = this.selectedAgentId === agent.id;

      ctx.beginPath();
      ctx.fillStyle = fill;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      if (isSelected) {
        ctx.lineWidth = Math.max(1, Math.floor(radius / 2));
        ctx.strokeStyle = '#f8fafc';
        ctx.shadowBlur = Math.max(4, radius * 1.2);
        ctx.shadowColor = 'rgba(248, 250, 252, 0.75)';
        ctx.stroke();
      }
    }

    ctx.restore();
    this.needsRedraw = false;
  }
}
