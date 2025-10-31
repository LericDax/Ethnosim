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

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

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
  const pulsesPart = Array.isArray(data.pulses)
    ? data.pulses
        .map((pulse) =>
          `${pulse?.edgeId ?? ''}:${Number(pulse?.progress ?? 0).toFixed(3)}:${Number(pulse?.strength ?? 0).toFixed(3)}`,
        )
        .sort()
        .join(';')
    : 'none';
  const fillRatios = data.fillRatios && typeof data.fillRatios === 'object' ? data.fillRatios : null;
  const fillPart = fillRatios
    ? Object.entries(fillRatios)
        .map(([nodeId, value]) => `${nodeId}:${Number(value ?? 0).toFixed(3)}`)
        .sort()
        .join(';')
    : 'none';
  return `${nodePart}__${edgePart}__${current}__${decision}__${pulsesPart}__${fillPart}`;
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
    this._nodeDurations = new Map();
    this._nodeFillRatios = new Map();
    this._activePulses = [];
    this._pixelRatio = window.devicePixelRatio || 1;
    this._width = 0;
    this._height = 0;
    this._needsLayout = true;
    this._needsRedraw = true;
    this._rafId = null;
    this._lastTimestamp = null;
    this._decisionEdgeKey = 'none';
    this._decisionPulse = 0;
    this._transitionTiming = null;
    this._lastTickDurationMs = 500;
    this._isPaused = false;
    this._pauseTimestamp = null;

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
    this._activePulses = [];
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    } else {
      window.removeEventListener('resize', this._handleResize);
    }
  }

  setData(data) {
    const transition = data?.transition ?? null;
    if (transition) {
      this._lastTickDurationMs = this._resolveTickDurationMs(transition);
    }

    const pulses = Array.isArray(data?.pulses) ? data.pulses : [];
    const fillRatios = data && typeof data.fillRatios === 'object' ? data.fillRatios : null;
    const signatureSource = data
      ? { ...data, pulses, fillRatios: fillRatios ?? undefined }
      : data;
    const signature = computeDataSignature(signatureSource);
    if (signature === this._dataSignature) {
      this._transitionTiming = transition;
      this._applyFillRatios(fillRatios);
      this._updateDecisionState(data?.decision ?? null, transition);
      this._ingestSnapshotPulses(pulses, transition);
      return;
    }

    this._dataSignature = signature;
    const hasNodes = data && Array.isArray(data.nodes) && data.nodes.length > 0;
    this._data = hasNodes
      ? {
          nodes: data.nodes,
          edges: data.edges,
          currentNodeId: data.currentNodeId ?? data.summary?.nodeId ?? null,
          decision: data.decision ?? null,
          transition,
          summary: data.summary ?? null,
        }
      : null;
    this.emptyState.style.display = this._data ? 'none' : 'flex';
    if (!this._data) {
      this.setLabel(null);
    }

    if (!this._data) {
      this._orderedNodes = [];
      this._edges = [];
      this._nodePositions.clear();
      this._edgeSegments = [];
      this._nodeDurations.clear();
      this._nodeFillRatios.clear();
      this._activePulses = [];
      this._decisionEdgeKey = 'none';
      this._decisionPulse = 0;
      this._transitionTiming = transition;
      this._needsLayout = true;
      this._needsRedraw = true;
      this._stopAnimation();
      this._drawBackground();
      return;
    }

    this._orderedNodes = [...this._data.nodes].filter((node) => node && node.id).map((node) => ({ ...node }));
    this._orderedNodes.sort((a, b) => {
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
    this._nodeDurations = new Map(
      this._orderedNodes.map((node) => [node.id, this._sanitizeDuration(node.duration)]),
    );
    this._activePulses = [];
    this._applyFillRatios(fillRatios);
    this._needsLayout = true;
    this._needsRedraw = true;
    this._transitionTiming = transition;
    this._updateDecisionState(this._data.decision ?? null, transition, true);
    this._ingestSnapshotPulses(pulses, transition);

    if (this._isPaused) {
      if (this._needsLayout) {
        this._rebuildLayout();
      }
      this._draw();
    } else {
      this._startAnimation();
    }
  }

  setLabel(label) {
    const text = label ? String(label) : '';
    this.labelEl.textContent = text;
    this.labelEl.style.display = text ? 'block' : 'none';
    this.labelEl.style.opacity = text ? '0.92' : '0';
  }

  setPaused(isPaused) {
    const next = Boolean(isPaused);
    if (next === this._isPaused) {
      return;
    }

    this._isPaused = next;
    if (next) {
      this._pauseTimestamp = typeof performance !== 'undefined' ? performance.now() : null;
      this._stopAnimation();
      if (this._data) {
        if (this._needsLayout) {
          this._rebuildLayout();
        }
        this._draw();
      }
      return;
    }

    const resumeTime = typeof performance !== 'undefined' ? performance.now() : null;
    if (resumeTime != null && this._pauseTimestamp != null) {
      const pausedDuration = resumeTime - this._pauseTimestamp;
      for (const pulse of this._activePulses) {
        pulse.startedAt += pausedDuration;
      }
    }
    this._pauseTimestamp = null;
    this._lastTimestamp = null;
    this._needsRedraw = true;
    if (this._data) {
      this._startAnimation();
    } else {
      this._drawBackground();
    }
  }

  _sanitizeDuration(duration) {
    const numeric = Number(duration);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 1;
    }
    return numeric;
  }

  _applyFillRatios(fillRatios) {
    this._nodeFillRatios.clear();
    if (!fillRatios || typeof fillRatios !== 'object') {
      return;
    }
    const entries = Object.entries(fillRatios)
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .map(([nodeId, value]) => ({ nodeId, value: clamp01(Number(value)) }));
    entries.sort((a, b) => b.value - a.value);
    for (const entry of entries) {
      this._nodeFillRatios.set(entry.nodeId, entry.value);
    }
  }

  _resolveTickDurationMs(timing) {
    if (timing && Number.isFinite(timing.tickDurationMs) && timing.tickDurationMs > 0) {
      return timing.tickDurationMs;
    }
    if (timing && Number.isFinite(timing.tickIntervalMs) && Number.isFinite(timing.ticksPerUpdate) && timing.ticksPerUpdate > 0) {
      return timing.tickIntervalMs / timing.ticksPerUpdate;
    }
    if (timing && Number.isFinite(timing.tickIntervalMs) && timing.tickIntervalMs > 0) {
      return timing.tickIntervalMs;
    }
    return this._lastTickDurationMs > 0 ? this._lastTickDurationMs : 1;
  }

  _resolveNodeDuration(nodeId) {
    if (!nodeId) {
      return 1;
    }
    if (this._nodeDurations.has(nodeId)) {
      return this._nodeDurations.get(nodeId);
    }
    return 1;
  }

  _updateDecisionState(decision, timing = null, forcePulse = false) {
    const edgeId = decision && decision.fromNodeId && decision.chosenNodeId
      ? `${decision.fromNodeId}->${decision.chosenNodeId}`
      : null;
    const key = decision
      ? `${edgeId ?? ''}|${(decision.candidates ?? []).length}`
      : 'none';
    const isNewDecision = forcePulse || key !== this._decisionEdgeKey;

    if (timing) {
      this._lastTickDurationMs = this._resolveTickDurationMs(timing);
    }

    if (isNewDecision) {
      this._decisionPulse = decision ? 1 : 0;
      if (decision && edgeId) {
        this._spawnPulse(edgeId, decision, timing);
      }
    } else if (decision && edgeId && timing) {
      this._syncPulsesWithTiming(edgeId, timing);
    }

    this._decisionEdgeKey = key;
    this._decision = decision ?? null;
    this._transitionTiming = timing ?? this._transitionTiming;
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
      if (this._isPaused) {
        if (this._needsLayout) {
          this._rebuildLayout();
        }
        this._draw();
      } else {
        this._startAnimation();
      }
    } else {
      this._drawBackground();
    }
  }

  _startAnimation() {
    if (this._rafId !== null || this._isPaused) {
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

    this._advancePulses(timestamp);
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
          length: Math.hypot(to.x - from.x, to.y - from.y),
        };
      })
      .filter(Boolean);

    this._needsRedraw = true;
  }

  _advancePulses(timestamp) {
    if (!this._activePulses.length || !this._edgeSegments.length) {
      return;
    }

    const now = timestamp ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const segmentsById = new Map(this._edgeSegments.map((segment) => [segment.id, segment]));
    const active = [];
    let changed = false;
    for (const pulse of this._activePulses) {
      const segment = segmentsById.get(pulse.edgeId);
      if (!segment) {
        changed = true;
        continue;
      }
      const durationMs = pulse.durationMs > 0 ? pulse.durationMs : this._lastTickDurationMs;
      const elapsedMs = Math.max(0, now - pulse.startedAt);
      const progress = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 1;
      if (Math.abs(progress - (pulse.progress ?? 0)) > 0.001) {
        changed = true;
      }
      pulse.progress = progress;
      pulse.segment = segment;
      if (progress < 1) {
        active.push(pulse);
      } else {
        changed = true;
      }
    }
    if (changed) {
      this._needsRedraw = true;
    }
    this._activePulses = active;
  }

  _ingestSnapshotPulses(pulses, timing) {
    const decisionPulses = this._activePulses.filter((pulse) => pulse.kind === 'decision');
    if (!Array.isArray(pulses) || pulses.length === 0) {
      this._activePulses = decisionPulses;
      this._needsRedraw = true;
      return;
    }

    const tickDurationMs = this._resolveTickDurationMs(timing);
    const baseDurationMs = Math.max(tickDurationMs, tickDurationMs * 4);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const snapshotPulses = pulses
      .map((pulse, index) => {
        const edgeId = pulse?.edgeId;
        if (!edgeId) {
          return null;
        }
        const progress = clamp01(Number(pulse.progress ?? 0));
        const strength = clamp01(Number(pulse.strength ?? 0));
        const durationMs = baseDurationMs;
        const startedAt = durationMs > 0 ? now - progress * durationMs : now;
        return {
          id: `snapshot-${index}-${edgeId}`,
          kind: 'snapshot',
          edgeId,
          fromNodeId: null,
          toNodeId: null,
          startedAt,
          durationTicks: 1,
          durationMs,
          progress,
          appearance: this._createSnapshotPulseAppearance(strength),
          segment: null,
          strength,
        };
      })
      .filter(Boolean);

    this._activePulses = decisionPulses.concat(snapshotPulses);
    this._needsRedraw = true;
  }

  _createPulseAppearance(kind) {
    if (kind === 'decision') {
      return {
        color: PARTICLE_DECISION_COLOR,
        opacity: 0.95,
        size: 3.6,
        trailColor: 'rgba(56, 189, 248, 0.45)',
        trailWidth: 1.4,
        glowColor: 'rgba(56, 189, 248, 0.28)',
        glowSize: 9,
      };
    }
    return {
      color: PARTICLE_COLOR,
      opacity: 0.78,
      size: 2.6,
    };
  }

  _createSnapshotPulseAppearance(strength) {
    const ratio = clamp01(Number(strength));
    return {
      color: PARTICLE_COLOR,
      opacity: 0.45 + ratio * 0.35,
      size: 2.1 + ratio * 2.6,
    };
  }

  _spawnPulse(edgeId, decision, timing) {
    if (!edgeId) {
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const toNodeId = decision?.chosenNodeId ?? null;
    const durationTicks = timing && Number.isFinite(timing.durationTicks) && timing.durationTicks > 0
      ? timing.durationTicks
      : this._resolveNodeDuration(toNodeId);
    const tickDurationMs = this._resolveTickDurationMs(timing);
    const pulse = {
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      kind: 'decision',
      edgeId,
      fromNodeId: decision?.fromNodeId ?? null,
      toNodeId,
      startedAt: now,
      durationTicks,
      durationMs: Math.max(tickDurationMs, durationTicks * tickDurationMs),
      progress: 0,
      appearance: this._createPulseAppearance('decision'),
      segment: null,
    };
    if (timing) {
      this._syncPulseWithTiming(pulse, timing, now);
    }
    this._activePulses.push(pulse);
    this._needsRedraw = true;
  }

  _syncPulseWithTiming(pulse, timing, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    if (!timing) {
      return;
    }
    const tickDurationMs = this._resolveTickDurationMs(timing);
    const durationTicks = timing && Number.isFinite(timing.durationTicks) && timing.durationTicks > 0
      ? timing.durationTicks
      : pulse.durationTicks ?? this._resolveNodeDuration(pulse.toNodeId);
    const safeDurationTicks = Math.max(1, durationTicks);
    const remainingTicks = timing && Number.isFinite(timing.remainingTicks)
      ? Math.max(0, Math.min(safeDurationTicks, timing.remainingTicks))
      : Math.max(0, safeDurationTicks - (timing.elapsedTicks ?? 0));
    const elapsedTicks = Math.max(0, Math.min(safeDurationTicks, safeDurationTicks - remainingTicks));
    pulse.durationTicks = safeDurationTicks;
    pulse.durationMs = Math.max(tickDurationMs, safeDurationTicks * tickDurationMs);
    const elapsedMs = Math.min(pulse.durationMs, elapsedTicks * tickDurationMs);
    pulse.startedAt = now - elapsedMs;
    pulse.progress = pulse.durationMs > 0 ? Math.min(1, elapsedMs / pulse.durationMs) : 1;
  }

  _syncPulsesWithTiming(edgeId, timing) {
    if (!edgeId || !timing) {
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const pulse of this._activePulses) {
      if (pulse.edgeId === edgeId && pulse.kind !== 'snapshot') {
        this._syncPulseWithTiming(pulse, timing, now);
      }
    }
    this._needsRedraw = true;
  }

  _drawPulses(ctx) {
    if (!this._activePulses.length || !this._edgeSegments.length) {
      return;
    }
    const segmentsById = new Map(this._edgeSegments.map((segment) => [segment.id, segment]));
    for (const pulse of this._activePulses) {
      const segment = segmentsById.get(pulse.edgeId);
      if (!segment) {
        continue;
      }
      const t = Math.max(0, Math.min(1, pulse.progress ?? 0));
      const x = segment.from.x + (segment.to.x - segment.from.x) * t;
      const y = segment.from.y + (segment.to.y - segment.from.y) * t;
      const appearance = pulse.appearance ?? {};
      const size = appearance.size ?? 3;
      const opacity = appearance.opacity ?? 0.85;
      const color = appearance.color ?? PARTICLE_COLOR;
      ctx.save();
      if (appearance.trailColor && appearance.trailWidth) {
        const trailFactor = 0.1;
        const trailT = Math.max(0, t - trailFactor);
        const trailX = segment.from.x + (segment.to.x - segment.from.x) * trailT;
        const trailY = segment.from.y + (segment.to.y - segment.from.y) * trailT;
        ctx.strokeStyle = appearance.trailColor;
        ctx.lineWidth = appearance.trailWidth;
        ctx.globalAlpha = Math.min(0.7, opacity);
        ctx.beginPath();
        ctx.moveTo(trailX, trailY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (appearance.glowColor && appearance.glowSize) {
        ctx.fillStyle = appearance.glowColor;
        ctx.globalAlpha = Math.min(0.6, opacity * 0.6);
        ctx.beginPath();
        ctx.arc(x, y, appearance.glowSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.restore();
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
      const fillRatio = this._nodeFillRatios.get(node.id) ?? 0;
      ctx.save();
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? NODE_HIGHLIGHT_FILL : NODE_FILL;
      ctx.globalAlpha = isCurrent ? 0.95 : 0.9;
      ctx.fill();
      if (fillRatio > 0) {
        const wedgeRadius = Math.max(2, radius - 2);
        ctx.beginPath();
        ctx.moveTo(position.x, position.y);
        ctx.arc(
          position.x,
          position.y,
          wedgeRadius,
          -Math.PI / 2,
          -Math.PI / 2 + fillRatio * Math.PI * 2,
          false,
        );
        ctx.closePath();
        ctx.fillStyle = isCurrent ? 'rgba(250, 204, 21, 0.6)' : 'rgba(56, 189, 248, 0.55)';
        ctx.globalAlpha = 0.45 + fillRatio * 0.45;
        ctx.fill();
      }
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

    this._drawPulses(ctx);

    ctx.restore();
  }
}
