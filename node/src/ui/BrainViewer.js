const DARK_BASE = '#020617';
const DARK_GRADIENT_INNER = 'rgba(15, 23, 42, 0.95)';
const DARK_GRADIENT_OUTER = 'rgba(2, 6, 23, 0.98)';
const EDGE_COLOR = 'rgba(94, 234, 212, 0.28)';
const EDGE_DECISION_COLOR = 'rgba(56, 189, 248, 0.92)';
const EDGE_DECISION_GLOW = 'rgba(14, 165, 233, 0.35)';
const NODE_FILL = 'rgba(30, 41, 59, 0.92)';
const NODE_STROKE = 'rgba(148, 163, 184, 0.55)';
const NODE_HIGHLIGHT_FILL = '#facc15';
const NODE_HIGHLIGHT_STROKE = '#fde68a';
const NODE_LABEL_COLOR = '#f8fafc';
const NODE_LABEL_MUTED = 'rgba(226, 232, 240, 0.7)';
const PARTICLE_COLOR = 'rgba(125, 211, 252, 0.82)';
const PARTICLE_DECISION_COLOR = '#fef08a';
const GRID_COLOR = 'rgba(15, 118, 110, 0.08)';
const GRID_STEP = 14;

function createScanlineOverlay() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(0,0,0,0) 65%)',
    backgroundSize: '100% 3px',
    mixBlendMode: 'soft-light',
    opacity: '0.35',
  });
  return overlay;
}

function computeDataSignature(data) {
  if (!data) return 'empty';
  const nodePart = (data.nodes ?? [])
    .map((node) => node?.id ?? '')
    .sort()
    .join('|');
  const edgePart = (data.edges ?? [])
    .map((edge) => `${edge?.from ?? ''}->${edge?.to ?? ''}:${Number(edge?.weight ?? 0).toFixed(3)}`)
    .sort()
    .join(';');
  const current = data.currentNodeId ?? '';
  const decision = data.decision
    ? `${data.decision.fromNodeId ?? ''}->${data.decision.chosenNodeId ?? ''}|${(data.decision.candidates ?? []).length}`
    : 'none';
  return `${nodePart}__${edgePart}__${current}__${decision}`;
}

function resolveClampValue(viewportClamp, minHeight) {
  if (!viewportClamp) return null;

  if (typeof viewportClamp === 'string') {
    return viewportClamp.trim() || null;
  }

  if (typeof viewportClamp === 'object') {
    const min = viewportClamp.min ?? minHeight;
    const max = viewportClamp.max ?? null;
    const viewport = viewportClamp.viewport ?? viewportClamp.preferred ?? viewportClamp.ideal;

    const minPart = typeof min === 'number' ? `${min}px` : String(min ?? `${minHeight}px`);
    const viewportPart = viewport ? (typeof viewport === 'number' ? `${viewport}vh` : String(viewport)) : null;
    const maxPart = max != null ? (typeof max === 'number' ? `${max}px` : String(max)) : null;

    if (viewportPart && maxPart) {
      return `clamp(${minPart}, ${viewportPart}, ${maxPart})`;
    }
    if (viewportPart) {
      return `clamp(${minPart}, ${viewportPart}, ${viewportPart})`;
    }
    if (maxPart) {
      return `clamp(${minPart}, ${maxPart}, ${maxPart})`;
    }
    return minPart;
  }

  return null;
}

export class BrainViewer {
  constructor({ minHeight = 220, viewportClamp = null } = {}) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'relative',
      width: '100%',
      minHeight: `${minHeight}px`,
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      background: '#020617',
      boxShadow: '0 12px 32px rgba(2, 6, 23, 0.45)',
    });

    const clampValue = resolveClampValue(viewportClamp, minHeight);
    if (clampValue) {
      this.root.style.height = clampValue;
      this.root.style.maxHeight = clampValue;
    }

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.root.appendChild(this.canvas);

    this.scanlines = createScanlineOverlay();
    this.root.appendChild(this.scanlines);

    this.labelEl = document.createElement('div');
    Object.assign(this.labelEl.style, {
      position: 'absolute',
      top: '8px',
      left: '12px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'rgba(226, 232, 240, 0.9)',
      pointerEvents: 'none',
      textShadow: '0 1px 2px rgba(2, 6, 23, 0.85)',
      opacity: '0.92',
      transition: 'opacity 160ms ease',
      display: 'none',
    });
    this.root.appendChild(this.labelEl);

    this.emptyState = document.createElement('div');
    this.emptyState.textContent = 'No brain state available.';
    Object.assign(this.emptyState.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      letterSpacing: '0.04em',
      color: NODE_LABEL_MUTED,
      textTransform: 'uppercase',
      pointerEvents: 'none',
    });
    this.root.appendChild(this.emptyState);

    this.ctx = this.canvas.getContext('2d');

    this._data = null;
    this._dataSignature = 'empty';
    this._orderedNodes = [];
    this._edges = [];
    this._nodePositions = new Map();
    this._edgeSegments = [];
    this._particles = [];
    this._pixelRatio = window.devicePixelRatio || 1;
    this._width = 0;
    this._height = 0;
    this._needsLayout = true;
    this._needsRedraw = true;
    this._rafId = null;
    this._lastTimestamp = null;
    this._decisionEdgeKey = 'none';
    this._decisionPulse = 0;

    this._handleResize = this._handleResize.bind(this);
    this._renderFrame = this._renderFrame.bind(this);

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._handleResize);
      this._resizeObserver.observe(this.root);
    } else {
      this._resizeObserver = null;
      window.addEventListener('resize', this._handleResize);
    }
  }

  get element() {
    return this.root;
  }

  destroy() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this._handleResize);
    }
  }

  setData(data) {
    const signature = computeDataSignature(data);
    if (signature === this._dataSignature) {
      this._updateDecisionState(data?.decision ?? null);
      return;
    }

    this._dataSignature = signature;
    this._data = data && Array.isArray(data.nodes) && data.nodes.length > 0 ? data : null;
    this.emptyState.style.display = this._data ? 'none' : 'flex';
    if (!this._data) {
      this.setLabel(null);
    }

    if (!this._data) {
      this._orderedNodes = [];
      this._edges = [];
      this._nodePositions.clear();
      this._edgeSegments = [];
      this._particles = [];
      this._decisionEdgeKey = 'none';
      this._decisionPulse = 0;
      this._needsLayout = true;
      this._needsRedraw = true;
      this._stopAnimation();
      this._drawBackground();
      return;
    }

    this._orderedNodes = [...this._data.nodes].filter((node) => node && node.id).sort((a, b) => {
      return String(a.id).localeCompare(String(b.id));
    });

    this._edges = [...(this._data.edges ?? [])]
      .map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        fromId: edge.from,
        toId: edge.to,
        weight: Number.isFinite(edge.weight) ? Number(edge.weight) : Number(edge.weight ?? 0) || 0,
      }))
      .filter((edge) => edge.fromId && edge.toId);

    this._nodePositions = new Map();
    this._edgeSegments = [];
    this._particles = [];
    this._needsLayout = true;
    this._needsRedraw = true;
    this._updateDecisionState(this._data.decision ?? null, true);

    const totalParticles = Math.max(6, Math.min(48, this._edges.length * 3));
    for (let i = 0; i < totalParticles; i += 1) {
      const edge = this._edges[i % this._edges.length];
      this._particles.push({
        edgeId: edge.id,
        t: Math.random(),
        speed: 0.12 + Math.random() * 0.25,
      });
    }

    this._startAnimation();
  }

  setLabel(label) {
    const text = label ? String(label) : '';
    this.labelEl.textContent = text;
    this.labelEl.style.display = text ? 'block' : 'none';
    this.labelEl.style.opacity = text ? '0.92' : '0';
  }

  _updateDecisionState(decision, forcePulse = false) {
    const key = decision
      ? `${decision.fromNodeId ?? ''}->${decision.chosenNodeId ?? ''}|${(decision.candidates ?? []).length}`
      : 'none';
    if (forcePulse || key !== this._decisionEdgeKey) {
      this._decisionPulse = decision ? 1 : 0;
    }
    this._decisionEdgeKey = key;
    this._decision = decision ?? null;
    this._needsRedraw = true;
  }

  _handleResize() {
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const pixelRatio = window.devicePixelRatio || 1;

    if (width === this._width && height === this._height && pixelRatio === this._pixelRatio) {
      return;
    }

    this._width = width;
    this._height = height;
    this._pixelRatio = pixelRatio;
    this.canvas.width = Math.max(1, Math.floor(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    this._needsLayout = true;
    this._needsRedraw = true;

    if (this._data) {
      this._startAnimation();
    } else {
      this._drawBackground();
    }
  }

  _startAnimation() {
    if (this._rafId !== null) {
      return;
    }
    this._lastTimestamp = null;
    this._rafId = requestAnimationFrame(this._renderFrame);
  }

  _stopAnimation() {
    if (this._rafId === null) {
      return;
    }
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._lastTimestamp = null;
  }

  _renderFrame(timestamp) {
    if (!this._data) {
      this._stopAnimation();
      return;
    }

    const dt = this._lastTimestamp ? Math.min(0.25, (timestamp - this._lastTimestamp) / 1000) : 0;
    this._lastTimestamp = timestamp;

    if (this._needsLayout) {
      this._rebuildLayout();
    }

    this._advanceParticles(dt);
    this._decisionPulse = Math.max(0, this._decisionPulse - dt * 0.5);

    if (this._needsRedraw || dt > 0) {
      this._draw();
      this._needsRedraw = false;
    }

    this._rafId = requestAnimationFrame(this._renderFrame);
  }

  _rebuildLayout() {
    this._needsLayout = false;
    this._nodePositions.clear();
    this._edgeSegments = [];

    if (!this._orderedNodes.length || !this._width || !this._height) {
      return;
    }

    const centerX = this._width / 2;
    const centerY = this._height / 2;
    const radius = Math.max(24, Math.min(centerX, centerY) - 28);

    const total = this._orderedNodes.length;
    this._orderedNodes.forEach((node, index) => {
      const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      this._nodePositions.set(node.id, { x, y, node });
    });

    this._edgeSegments = this._edges
      .map((edge) => {
        const from = this._nodePositions.get(edge.fromId);
        const to = this._nodePositions.get(edge.toId);
        if (!from || !to) {
          return null;
        }
        return {
          id: edge.id,
          from,
          to,
          weight: edge.weight,
        };
      })
      .filter(Boolean);

    this._needsRedraw = true;
  }

  _advanceParticles(dt) {
    if (!dt || !this._particles.length) {
      return;
    }
    const segmentsById = new Map(this._edgeSegments.map((segment) => [segment.id, segment]));
    for (const particle of this._particles) {
      particle.t += particle.speed * dt;
      while (particle.t > 1) {
        particle.t -= 1;
      }
      if (!segmentsById.has(particle.edgeId)) {
        const randomSegment = this._edgeSegments[Math.floor(Math.random() * this._edgeSegments.length)];
        if (randomSegment) {
          particle.edgeId = randomSegment.id;
          particle.t = Math.random();
        }
      }
    }
  }

  _drawBackground() {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (!width || !height) {
      return;
    }
    ctx.save();
    ctx.scale(this._pixelRatio, this._pixelRatio);
    ctx.clearRect(0, 0, this._width, this._height);
    ctx.fillStyle = DARK_BASE;
    ctx.fillRect(0, 0, this._width, this._height);

    const gradient = ctx.createRadialGradient(
      this._width / 2,
      this._height / 2,
      Math.max(12, Math.min(this._width, this._height) * 0.1),
      this._width / 2,
      this._height / 2,
      Math.max(this._width, this._height) * 0.65,
    );
    gradient.addColorStop(0, DARK_GRADIENT_INNER);
    gradient.addColorStop(1, DARK_GRADIENT_OUTER);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this._width, this._height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    for (let x = -this._height; x < this._width + this._height; x += GRID_STEP) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + this._height, this._height);
    }
    ctx.stroke();
    ctx.restore();
  }

  _draw() {
    if (!this.ctx) {
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this._pixelRatio, this._pixelRatio);
    ctx.clearRect(0, 0, this._width, this._height);

    const gradient = ctx.createRadialGradient(
      this._width / 2,
      this._height / 2,
      Math.max(12, Math.min(this._width, this._height) * 0.1),
      this._width / 2,
      this._height / 2,
      Math.max(this._width, this._height) * 0.65,
    );
    gradient.addColorStop(0, DARK_GRADIENT_INNER);
    gradient.addColorStop(1, DARK_GRADIENT_OUTER);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this._width, this._height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    for (let x = -this._height; x < this._width + this._height; x += GRID_STEP) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + this._height, this._height);
    }
    ctx.stroke();

    const decisionKey = this._decisionEdgeKey;
    const pulse = 0.45 + this._decisionPulse * 0.55;

    ctx.lineCap = 'round';
    for (const segment of this._edgeSegments) {
      const isDecision = decisionKey !== 'none' && decisionKey.startsWith(segment.id);
      ctx.save();
      ctx.globalAlpha = isDecision ? Math.min(1, 0.7 + pulse * 0.6) : 0.55 + Math.min(0.35, segment.weight * 0.25);
      ctx.lineWidth = isDecision ? 3 : 1.6;
      ctx.strokeStyle = isDecision ? EDGE_DECISION_COLOR : EDGE_COLOR;
      ctx.beginPath();
      ctx.moveTo(segment.from.x, segment.from.y);
      ctx.lineTo(segment.to.x, segment.to.y);
      ctx.stroke();
      if (isDecision) {
        ctx.globalAlpha = 0.45 * pulse;
        ctx.strokeStyle = EDGE_DECISION_GLOW;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(segment.from.x, segment.from.y);
        ctx.lineTo(segment.to.x, segment.to.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const currentNodeId = this._data?.currentNodeId ?? this._data?.summary?.nodeId ?? null;
    ctx.font = '11px "IBM Plex Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const node of this._orderedNodes) {
      const position = this._nodePositions.get(node.id);
      if (!position) continue;
      const isCurrent = node.id === currentNodeId;
      const radius = isCurrent ? 13 : 10;
      ctx.save();
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? NODE_HIGHLIGHT_FILL : NODE_FILL;
      ctx.globalAlpha = isCurrent ? 0.95 : 0.9;
      ctx.fill();
      ctx.lineWidth = isCurrent ? 2 : 1.5;
      ctx.strokeStyle = isCurrent ? NODE_HIGHLIGHT_STROKE : NODE_STROKE;
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (isCurrent) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius + 8 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.fillStyle = isCurrent ? NODE_LABEL_COLOR : NODE_LABEL_MUTED;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.85)';
      ctx.shadowBlur = 4;
      ctx.fillText(node.label ?? node.id, position.x, position.y + radius + 6);
      ctx.restore();

      if (isCurrent && Array.isArray(node.tags) && node.tags.length) {
        ctx.save();
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.fillStyle = 'rgba(248, 250, 252, 0.6)';
        ctx.textBaseline = 'top';
        ctx.fillText(node.tags.join(' · '), position.x, position.y - radius - 14);
        ctx.restore();
      }
    }

    if (this._particles.length && this._edgeSegments.length) {
      const segmentsById = new Map(this._edgeSegments.map((segment) => [segment.id, segment]));
      for (const particle of this._particles) {
        const segment = segmentsById.get(particle.edgeId);
        if (!segment) continue;
        const isDecision = decisionKey !== 'none' && decisionKey.startsWith(segment.id);
        const x = segment.from.x + (segment.to.x - segment.from.x) * particle.t;
        const y = segment.from.y + (segment.to.y - segment.from.y) * particle.t;
        ctx.save();
        ctx.fillStyle = isDecision ? PARTICLE_DECISION_COLOR : PARTICLE_COLOR;
        ctx.globalAlpha = isDecision ? 0.95 : 0.75;
        const size = isDecision ? 3.4 : 2.6;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
