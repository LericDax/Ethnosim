const DARK_BASE = '#020617';
const DARK_GRADIENT_INNER = 'rgba(15, 23, 42, 0.95)';
const DARK_GRADIENT_OUTER = 'rgba(2, 6, 23, 0.98)';
const EDGE_COLOR = 'rgba(94, 234, 212, 0.28)';
const EDGE_DECISION_COLOR = 'rgba(56, 189, 248, 0.92)';
const EDGE_DECISION_GLOW = 'rgba(14, 165, 233, 0.35)';
const EDGE_POTENTIATION_COLOR = 'rgba(56, 189, 248, 0.85)';
const EDGE_POTENTIATION_GLOW = 'rgba(125, 211, 252, 0.42)';
const EDGE_DEPRESSION_COLOR = 'rgba(248, 113, 113, 0.78)';
const EDGE_DEPRESSION_GLOW = 'rgba(251, 113, 133, 0.38)';
const TRACE_EDGE_COLOR = 'rgba(253, 224, 71, 0.85)';
const TRACE_EDGE_GLOW = 'rgba(253, 224, 71, 0.38)';
const TRACE_EDGE_DASH = [6, 4];
const NODE_FILL = 'rgba(30, 41, 59, 0.92)';
const NODE_STROKE = 'rgba(148, 163, 184, 0.55)';
const NODE_HIGHLIGHT_FILL = '#facc15';
const NODE_HIGHLIGHT_STROKE = '#fde68a';
const NODE_LABEL_COLOR = '#f8fafc';
const NODE_LABEL_MUTED = 'rgba(226, 232, 240, 0.7)';
const PARTICLE_COLOR = 'rgba(125, 211, 252, 0.82)';
const GRID_COLOR = 'rgba(15, 118, 110, 0.08)';
const GRID_STEP = 14;
const EDGE_ADJUSTMENT_MAX = 1;

const PARTICLE_BASE_OPACITY = 0.58;
const PARTICLE_OPACITY_RANGE = 0.38;
const PARTICLE_MIN_OPACITY = 0.12;
const PARTICLE_MAX_OPACITY = 0.98;
const PARTICLE_BASE_SIZE = 3.1;
const PARTICLE_SIZE_RANGE = 3.6;
const PARTICLE_MIN_SIZE = 2.4;
const PARTICLE_LOAD_SIZE_MULTIPLIER = 0.9;
const PARTICLE_LOAD_OPACITY_MULTIPLIER = 0.35;
const PARTICLE_RATE_BRIGHTNESS_MULTIPLIER = 0.25;
const PARTICLE_LOAD_GLOW_MULTIPLIER = 0.6;
const PARTICLE_RATE_GLOW_MULTIPLIER = 0.45;
const PULSE_VIEWER_REFERENCE_PAYLOAD = 0.24;
const PULSE_VIEWER_REFERENCE_RATE = 0.08;
const PULSE_VIEWER_MAX_LOAD_RATIO = 6;
const PULSE_VIEWER_MAX_RATE_RATIO = 4;

const PULSE_FAMILY_THEMES = {
  default: Object.freeze({ family: 'default', color: PARTICLE_COLOR, glowColor: 'rgba(125, 211, 252, 0.42)' }),
  empathy: Object.freeze({ family: 'empathy', color: '#7dd3fc', glowColor: 'rgba(125, 211, 252, 0.4)' }),
  vital: Object.freeze({ family: 'vital', color: '#fde047', glowColor: 'rgba(253, 224, 71, 0.38)' }),
  calm: Object.freeze({ family: 'calm', color: '#38bdf8', glowColor: 'rgba(56, 189, 248, 0.36)' }),
  danger: Object.freeze({ family: 'danger', color: '#fb7185', glowColor: 'rgba(248, 113, 113, 0.45)' }),
  insight: Object.freeze({ family: 'insight', color: '#c084fc', glowColor: 'rgba(192, 132, 252, 0.44)' }),
  resolve: Object.freeze({ family: 'resolve', color: '#22d3ee', glowColor: 'rgba(34, 211, 238, 0.42)' }),
  mystic: Object.freeze({ family: 'mystic', color: '#d8b4fe', glowColor: 'rgba(216, 180, 254, 0.46)' }),
};

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value <= min) return min;
  if (value >= max) return max;
  return value;
}

function resolvePulseFamilyTheme(family) {
  if (family && PULSE_FAMILY_THEMES[family]) {
    return PULSE_FAMILY_THEMES[family];
  }
  return PULSE_FAMILY_THEMES.default;
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
    .map((edge) =>
      `${edge?.from ?? ''}->${edge?.to ?? ''}:${Number(edge?.weight ?? 0).toFixed(3)}:${Number(
        edge?.adjustment ?? 0,
      ).toFixed(3)}`,
    )
    .sort()
    .join(';');
  const transientPart = Array.isArray(data.transientEdges)
    ? data.transientEdges
        .map((edge) =>
          `${edge?.kind ?? 'trace'}:${edge?.from ?? ''}->${edge?.to ?? ''}:${Number(edge?.weight ?? 0).toFixed(3)}:${Number(
            edge?.ttl ?? edge?.remainingTicks ?? 0,
          ).toFixed(0)}`,
        )
        .sort()
        .join(';')
    : 'none';
  const current = data.currentNodeId ?? '';
  const decision = data.decision
    ? `${data.decision.fromNodeId ?? ''}->${data.decision.chosenNodeId ?? ''}|${(data.decision.candidates ?? []).length}`
    : 'none';
  const pulsesPart = Array.isArray(data.pulses)
    ? data.pulses
        .map((pulse) =>
          `${
            pulse?.id ?? pulse?.edgeId ?? ''
          }:${Number(pulse?.startedAt ?? pulse?.startedAtTick ?? 0).toFixed(3)}:${Number(pulse?.strength ?? 0).toFixed(3)}:${Number(
            pulse?.payload ?? pulse?.load ?? 0,
          ).toFixed(3)}:${Number(pulse?.payloadRate ?? pulse?.rate ?? 0).toFixed(3)}:${Number(
            pulse?.durationTicks ?? pulse?.travelDurationTicks ?? pulse?.duration ?? 0,
          ).toFixed(3)}`,
        )
        .sort()
        .join(';')
    : 'none';
  const rawNodeFill = data.nodeFill && typeof data.nodeFill === 'object' ? data.nodeFill : null;
  const nodeFillRatios = rawNodeFill
    ? rawNodeFill.ratios && typeof rawNodeFill.ratios === 'object'
      ? rawNodeFill.ratios
      : rawNodeFill
    : data.fillRatios && typeof data.fillRatios === 'object'
      ? data.fillRatios
      : null;
  const fillPart = nodeFillRatios
    ? Object.entries(nodeFillRatios)
        .map(([nodeId, value]) => `${nodeId}:${Number(value ?? 0).toFixed(3)}`)
        .sort()
        .join(';')
    : 'none';
  const fillMetaPart = rawNodeFill
    ? `${rawNodeFill.lockedNodeId ?? ''}|${rawNodeFill.containsRecentCharge ? 1 : 0}`
    : 'none';
  const plasticityEdgesPart = Array.isArray(data?.plasticity?.edges)
    ? data.plasticity.edges
        .map((edge) =>
          `${edge?.from ?? ''}->${edge?.to ?? ''}:${Number(edge?.adjustment ?? 0).toFixed(3)}`,
        )
        .sort()
        .join(';')
    : 'none';
  const plasticityTickPart = Number.isFinite(data?.plasticity?.tick)
    ? Number(data.plasticity.tick).toFixed(0)
    : 'none';
  return `${nodePart}__${edgePart}__${transientPart}__${current}__${decision}__${pulsesPart}__${fillPart}__${fillMetaPart}__${plasticityTickPart}|${plasticityEdgesPart}`;
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

    this.plasticityLegendEl = document.createElement('div');
    Object.assign(this.plasticityLegendEl.style, {
      position: 'absolute',
      bottom: '10px',
      left: '12px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: 'rgba(148, 163, 184, 0.85)',
      pointerEvents: 'none',
      textShadow: '0 2px 6px rgba(2, 6, 23, 0.85)',
    });
    this._plasticityLegendDefault = 'Plasticity: teal ↑ / rose ↓';
    this.plasticityLegendEl.textContent = this._plasticityLegendDefault;
    this.plasticityLegendEl.style.display = 'none';
    this.root.appendChild(this.plasticityLegendEl);

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
    this._nodeFillContext = null;
    this._nextFillNodeId = null;
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
    this._simulationTickDurationMs = this._lastTickDurationMs;
    this._isPaused = false;
    this._snapshotPerfNow = null;
    this._snapshotSimTimeMs = null;
    this._pausedSimTimeMs = null;

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
      this._simulationTickDurationMs = this._lastTickDurationMs;
    }

    const pulses = Array.isArray(data?.pulses) ? data.pulses : [];
    const fillRatios = this._extractFillRatios(data);
    const fillContext = this._nodeFillContext;
    this._updateSimulationClock(transition);
    const signatureSource = data
      ? {
          ...data,
          pulses,
          nodeFill:
            fillContext != null
              ? {
                  lockedNodeId: fillContext.lockedNodeId ?? null,
                  containsRecentCharge: Boolean(fillContext.containsRecentCharge),
                  ratios: fillRatios ?? {},
                }
              : fillRatios ?? undefined,
        }
      : data;
    const signature = computeDataSignature(signatureSource);
    if (signature === this._dataSignature) {
      this._transitionTiming = transition;
      this._applyFillRatios(fillRatios);
      this._updateDecisionState(data?.decision ?? null, transition);
      this._updatePulsesFromDescriptors(pulses, transition);
      return;
    }

    this._dataSignature = signature;
    const hasNodes = data && Array.isArray(data.nodes) && data.nodes.length > 0;
    this._data = hasNodes
      ? {
          nodes: data.nodes,
          edges: data.edges,
          transientEdges: Array.isArray(data.transientEdges) ? data.transientEdges : [],
          currentNodeId: data.currentNodeId ?? data.summary?.nodeId ?? null,
          decision: data.decision ?? null,
          transition,
          summary: data.summary ?? null,
          plasticity: data.plasticity ?? null,
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
      this.canvas.title = 'Brain connectivity graph';
      if (this.plasticityLegendEl) {
        this.plasticityLegendEl.textContent = this._plasticityLegendDefault;
        this.plasticityLegendEl.style.display = 'none';
      }
      this._drawBackground();
      return;
    }

    this._orderedNodes = [...this._data.nodes].filter((node) => node && node.id).map((node) => ({ ...node }));
    this._orderedNodes.sort((a, b) => {
      return String(a.id).localeCompare(String(b.id));
    });

    const baseEdges = [...(this._data.edges ?? [])]
      .map((edge) => {
        const baseWeight = Number(edge.baseWeight ?? edge.weight ?? 0);
        const adjustment = Number(edge.adjustment ?? 0);
        const weightValue = Number(edge.weight ?? baseWeight + adjustment);
        const usageCount = Number(edge.usageCount ?? 0);
        const sanitizedBase = Number.isFinite(baseWeight) ? baseWeight : 0;
        const sanitizedAdjustment = Number.isFinite(adjustment) ? adjustment : 0;
        const sanitizedWeight = Number.isFinite(weightValue) ? weightValue : sanitizedBase + sanitizedAdjustment;
        return {
          id: `${edge.from}->${edge.to}`,
          fromId: edge.from,
          toId: edge.to,
          baseWeight: sanitizedBase,
          adjustment: sanitizedAdjustment,
          weight: Math.max(0, sanitizedWeight),
          usageCount: Number.isFinite(usageCount) ? usageCount : 0,
          kind: edge.kind ?? 'base',
          ttl: null,
        };
      })
      .filter((edge) => edge.fromId && edge.toId);
    const transientEdges = Array.isArray(this._data.transientEdges)
      ? this._data.transientEdges
          .map((edge) => {
            const weight = Number(edge?.weight ?? 0);
            const remaining = Number(edge?.remainingTicks ?? edge?.ttl ?? 0);
            const kind = edge?.kind ?? 'trace';
            return {
              id: `${kind}:${edge?.from ?? ''}->${edge?.to ?? ''}`,
              fromId: edge?.from ?? null,
              toId: edge?.to ?? null,
              baseWeight: weight,
              adjustment: 0,
              weight: Math.max(0, weight),
              usageCount: 0,
              kind,
              ttl: Number.isFinite(remaining) ? Math.max(0, remaining) : null,
            };
          })
          .filter((edge) => edge.fromId && edge.toId)
      : [];
    this._edges = [...baseEdges, ...transientEdges];

    const adjustmentEdges = this._edges.filter((edge) => Math.abs(edge.adjustment) > 1e-6);
    if (adjustmentEdges.length > 0) {
      const summary = adjustmentEdges
        .slice(0, 8)
        .map((edge) =>
          `${edge.fromId}→${edge.toId}:${edge.adjustment >= 0 ? '+' : ''}${edge.adjustment.toFixed(3)}`,
        )
        .join(', ');
      this.canvas.title = `Plasticity adjustments: ${summary}`;
      if (this.plasticityLegendEl) {
        const tick = Number(data?.plasticity?.tick);
        const legendText = Number.isFinite(tick)
          ? `${this._plasticityLegendDefault} (tick ${Math.max(0, Math.round(tick))})`
          : this._plasticityLegendDefault;
        this.plasticityLegendEl.textContent = legendText;
        this.plasticityLegendEl.style.display = 'block';
      }
    } else {
      this.canvas.title = 'Brain connectivity graph';
      if (this.plasticityLegendEl) {
        this.plasticityLegendEl.textContent = this._plasticityLegendDefault;
        this.plasticityLegendEl.style.display = 'none';
      }
    }

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
      this._updateDecisionState(this._data.decision ?? null, transition);
      this._updatePulsesFromDescriptors(pulses, transition);

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
      this._pausedSimTimeMs = this._getCurrentSimTimeMs();
      this._stopAnimation();
      if (this._data) {
        if (this._needsLayout) {
          this._rebuildLayout();
        }
        this._draw();
      }
      return;
    }

    const resumeNow = this._now();
    if (this._pausedSimTimeMs != null) {
      this._snapshotSimTimeMs = this._pausedSimTimeMs;
      this._snapshotPerfNow = resumeNow;
      this._pausedSimTimeMs = null;
    } else {
      this._snapshotPerfNow = resumeNow;
    }
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

  _extractFillRatios(data) {
    this._nodeFillContext = null;
    if (!data || typeof data !== 'object') {
      return null;
    }
    const nodeFillRaw = data.nodeFill && typeof data.nodeFill === 'object' ? data.nodeFill : null;
    if (nodeFillRaw) {
      const ratios =
        nodeFillRaw.ratios && typeof nodeFillRaw.ratios === 'object' ? nodeFillRaw.ratios : nodeFillRaw;
      const lockedNodeId =
        typeof nodeFillRaw.lockedNodeId === 'string' && nodeFillRaw.lockedNodeId
          ? nodeFillRaw.lockedNodeId
          : null;
      const containsRecentCharge = Boolean(nodeFillRaw.containsRecentCharge);
      this._nodeFillContext = {
        ratios,
        lockedNodeId,
        containsRecentCharge,
      };
      return ratios;
    }
    if (data.fillRatios && typeof data.fillRatios === 'object') {
      return data.fillRatios;
    }
    return null;
  }

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  _computeSimulationTimeFromTiming(timing, tickDurationMs) {
    if (!timing) {
      return null;
    }

    if (Number.isFinite(timing.currentTimeMs)) {
      return timing.currentTimeMs;
    }
    if (Number.isFinite(timing.updatedAtMs)) {
      return timing.updatedAtMs;
    }

    const safeTickMs = Number.isFinite(tickDurationMs) && tickDurationMs > 0 ? tickDurationMs : null;

    if (Number.isFinite(timing.updatedAtTick) && safeTickMs != null) {
      return timing.updatedAtTick * safeTickMs;
    }

    if (Number.isFinite(timing.startedAtTick) && Number.isFinite(timing.elapsedTicks) && safeTickMs != null) {
      return (timing.startedAtTick + timing.elapsedTicks) * safeTickMs;
    }

    if (Number.isFinite(timing.elapsedTicks) && safeTickMs != null) {
      return timing.elapsedTicks * safeTickMs;
    }

    return null;
  }

  _updateSimulationClock(timing) {
    const tickDurationMs = this._resolveTickDurationMs(timing);
    this._simulationTickDurationMs = tickDurationMs;
    const perfNow = this._now();
    const simTime = this._computeSimulationTimeFromTiming(timing, tickDurationMs);
    if (simTime != null) {
      this._snapshotSimTimeMs = simTime;
      this._snapshotPerfNow = perfNow;
      if (this._isPaused) {
        this._pausedSimTimeMs = simTime;
      }
      return;
    }

    if (this._snapshotPerfNow == null) {
      this._snapshotPerfNow = perfNow;
    }
    if (this._snapshotSimTimeMs == null) {
      this._snapshotSimTimeMs = perfNow;
    }
  }

  _getCurrentSimTimeMs() {
    if (this._isPaused && this._pausedSimTimeMs != null) {
      return this._pausedSimTimeMs;
    }
    const perfNow = this._now();
    if (this._snapshotPerfNow == null || this._snapshotSimTimeMs == null) {
      this._snapshotPerfNow = perfNow;
      this._snapshotSimTimeMs = perfNow;
      return perfNow;
    }
    return this._snapshotSimTimeMs + (perfNow - this._snapshotPerfNow);
  }

  _applyFillRatios(fillRatios) {
    this._nodeFillRatios.clear();
    this._nextFillNodeId = null;
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
    if (entries.length > 0) {
      this._nextFillNodeId = entries[0].nodeId;
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

  _updateDecisionState(decision, timing = null) {
    const edgeId = decision && decision.fromNodeId && decision.chosenNodeId
      ? `${decision.fromNodeId}->${decision.chosenNodeId}`
      : null;
    const key = decision
      ? `${edgeId ?? ''}|${(decision.candidates ?? []).length}`
      : 'none';
    const isNewDecision = key !== this._decisionEdgeKey;

    if (timing) {
      this._lastTickDurationMs = this._resolveTickDurationMs(timing);
    }

    if (isNewDecision) {
      this._decisionPulse = decision ? 1 : 0;
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

    this._advancePulses();
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
        const weight = Math.max(0, Number(edge.weight ?? 0));
        const baseWeight = Number.isFinite(edge.baseWeight) ? edge.baseWeight : weight;
        const adjustment = Number(edge.adjustment ?? 0);
        const usageCount = Number.isFinite(edge.usageCount) ? edge.usageCount : 0;
        return {
          id: edge.id,
          from,
          to,
          weight,
          baseWeight,
          adjustment,
          usageCount,
          adjustmentMagnitude: Math.abs(adjustment),
          length: Math.hypot(to.x - from.x, to.y - from.y),
          kind: edge.kind ?? 'base',
          ttl: edge.ttl ?? null,
        };
      })
      .filter(Boolean);

    this._needsRedraw = true;
  }

  _advancePulses() {
    if (!this._activePulses.length || !this._edgeSegments.length) {
      return;
    }

    const nowSim = this._getCurrentSimTimeMs();
    const segmentsById = new Map(this._edgeSegments.map((segment) => [segment.id, segment]));
    let changed = false;

    for (const pulse of this._activePulses) {
      const segment = segmentsById.get(pulse.edgeId);
      if (!segment) {
        continue;
      }
      const durationMs = Number.isFinite(pulse.durationMs) && pulse.durationMs > 0
        ? pulse.durationMs
        : this._simulationTickDurationMs;
      const startedAt = Number.isFinite(pulse.startedAtSimMs)
        ? pulse.startedAtSimMs
        : Number.isFinite(this._snapshotSimTimeMs)
          ? this._snapshotSimTimeMs
          : nowSim;
      const elapsedMs = Math.max(0, nowSim - startedAt);
      const progress = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 1;
      if (Math.abs(progress - (pulse.progress ?? 0)) > 0.001) {
        changed = true;
      }
      pulse.progress = progress;
      pulse.segment = segment;
    }

    if (changed) {
      this._needsRedraw = true;
    }
  }

  _updatePulsesFromDescriptors(pulses, timing) {
    if (!Array.isArray(pulses) || pulses.length === 0) {
      if (this._activePulses.length > 0) {
        this._activePulses = [];
        this._needsRedraw = true;
      }
      return;
    }

    const tickDurationMs = this._resolveTickDurationMs(timing ?? this._transitionTiming);
    const referenceSimTime = Number.isFinite(this._snapshotSimTimeMs)
      ? this._snapshotSimTimeMs
      : this._getCurrentSimTimeMs();
    const existingById = new Map(this._activePulses.map((pulse) => [pulse.id, pulse]));
    const nextPulses = [];

    pulses.forEach((descriptor, index) => {
      if (!descriptor || typeof descriptor !== 'object') {
        return;
      }
      const edgeId = descriptor.edgeId ?? descriptor.edge ?? null;
      if (!edgeId) {
        return;
      }
      const id = this._resolvePulseId(descriptor, index);
      if (!id) {
        return;
      }
      const payload = Math.max(
        0,
        Number(
          descriptor.payload ??
            descriptor.load ??
            descriptor.strength ??
            descriptor.intensity ??
            0,
        ),
      );
      const rawPayloadRate = Number(descriptor.payloadRate ?? descriptor.rate ?? 0);
      let payloadRate = Number.isFinite(rawPayloadRate) ? Math.max(0, rawPayloadRate) : 0;
      const descriptorDurationTicks = Number(
        descriptor.durationTicks ?? descriptor.travelDurationTicks ?? null,
      );
      if (payloadRate <= 0 && Number.isFinite(descriptorDurationTicks) && descriptorDurationTicks > 0 && payload > 0) {
        payloadRate = payload / descriptorDurationTicks;
      }
      const durationMs = this._resolvePulseDurationMs(
        descriptor,
        tickDurationMs,
        edgeId,
        payload,
        payloadRate,
      );
      const startedAtSimMs = this._resolvePulseStartSimMs(
        descriptor,
        tickDurationMs,
        referenceSimTime,
        durationMs,
      );
      const strength = clamp01(Number(descriptor.strength ?? descriptor.intensity ?? 1));
      const appearance = this._createSnapshotPulseAppearance(strength, descriptor);
      const pulse = existingById.get(id) ?? { id, progress: 0 };
      pulse.id = id;
      pulse.edgeId = edgeId;
      pulse.durationMs = durationMs;
      pulse.startedAtSimMs = startedAtSimMs;
      pulse.strength = strength;
      pulse.payload = payload;
      pulse.payloadRate = payloadRate;
      pulse.loadRatio = payload > 0
        ? Math.min(payload / PULSE_VIEWER_REFERENCE_PAYLOAD, PULSE_VIEWER_MAX_LOAD_RATIO)
        : 0;
      pulse.rateRatio = payloadRate > 0
        ? Math.min(payloadRate / PULSE_VIEWER_REFERENCE_RATE, PULSE_VIEWER_MAX_RATE_RATIO)
        : 0;
      pulse.durationTicks = Number.isFinite(descriptorDurationTicks) && descriptorDurationTicks > 0
        ? descriptorDurationTicks
        : payloadRate > 0 && payload > 0
          ? payload / payloadRate
          : null;
      pulse.appearance = appearance;
      pulse.segment = null;
      pulse.descriptor = descriptor;
      nextPulses.push(pulse);
    });

    this._activePulses = nextPulses;
    this._needsRedraw = true;
  }

  _resolvePulseId(descriptor, index) {
    if (!descriptor || typeof descriptor !== 'object') {
      return null;
    }
    if (descriptor.id != null) {
      return String(descriptor.id);
    }
    const edgeId = descriptor.edgeId ?? descriptor.edge ?? null;
    if (!edgeId) {
      return null;
    }
    if (descriptor.uid != null) {
      return `${edgeId}|${descriptor.uid}`;
    }
    const startedAt = descriptor.startedAt ?? descriptor.startedAtMs ?? descriptor.startedAtTick;
    if (startedAt != null) {
      return `${edgeId}|${startedAt}`;
    }
    if (descriptor.started_at_tick != null) {
      return `${edgeId}|${descriptor.started_at_tick}`;
    }
    return `${edgeId}|${index}`;
  }

  _parseEdgeTarget(edgeId) {
    if (typeof edgeId !== 'string') {
      return null;
    }
    const parts = edgeId.split('->');
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
    return null;
  }

  _resolvePulseDurationMs(descriptor, tickDurationMs, edgeId, payload = 0, payloadRate = 0) {
    const durationCandidates = [
      descriptor.durationMs,
      descriptor.duration_ms,
      descriptor.durationMilliseconds,
      descriptor.travelDurationMs,
      descriptor.travel_duration_ms,
      descriptor.duration,
    ];
    for (const candidate of durationCandidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }

    const tickCandidates = [
      descriptor.durationTicks,
      descriptor.duration_ticks,
      descriptor.ticks,
      descriptor.travelDurationTicks,
      descriptor.travel_duration_ticks,
      descriptor.travelDuration,
    ];
    for (const candidate of tickCandidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        if (Number.isFinite(tickDurationMs) && tickDurationMs > 0) {
          return numeric * tickDurationMs;
        }
        return numeric;
      }
    }

    const toNodeId = this._parseEdgeTarget(edgeId);
    const fallbackTicks = this._resolveNodeDuration(toNodeId);
    let resolved = null;
    if (Number.isFinite(fallbackTicks) && fallbackTicks > 0) {
      resolved = Number.isFinite(tickDurationMs) && tickDurationMs > 0 ? fallbackTicks * tickDurationMs : fallbackTicks;
    }

    const derivedTicks = payloadRate > 0 && payload > 0 ? payload / payloadRate : null;
    if (Number.isFinite(derivedTicks) && derivedTicks > 0) {
      const derivedMs = Number.isFinite(tickDurationMs) && tickDurationMs > 0 ? derivedTicks * tickDurationMs : derivedTicks;
      if (!Number.isFinite(resolved) || resolved <= 0) {
        resolved = derivedMs;
      } else {
        resolved = resolved * 0.7 + derivedMs * 0.3;
      }
    }

    if (!Number.isFinite(resolved) || resolved <= 0) {
      resolved = Number.isFinite(tickDurationMs) && tickDurationMs > 0 ? tickDurationMs : this._lastTickDurationMs;
    }

    return resolved;
  }

  _resolvePulseStartSimMs(descriptor, tickDurationMs, referenceSimTime, durationMs) {
    const msKeys = [
      'startedAtMs',
      'started_at_ms',
      'startedAtMilliseconds',
      'startedAt',
    ];
    for (const key of msKeys) {
      if (descriptor[key] == null) {
        continue;
      }
      const numeric = Number(descriptor[key]);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    const secondKeys = ['startedAtSeconds', 'started_at_seconds'];
    for (const key of secondKeys) {
      if (descriptor[key] == null) {
        continue;
      }
      const numeric = Number(descriptor[key]);
      if (Number.isFinite(numeric)) {
        return numeric * 1000;
      }
    }

    const tickKeys = ['startedAtTick', 'started_at_tick'];
    for (const key of tickKeys) {
      if (descriptor[key] == null) {
        continue;
      }
      const numeric = Number(descriptor[key]);
      if (Number.isFinite(numeric)) {
        if (Number.isFinite(tickDurationMs) && tickDurationMs > 0) {
          return numeric * tickDurationMs;
        }
        return numeric;
      }
    }

    const elapsedMsKeys = ['elapsedMs', 'elapsedMilliseconds'];
    for (const key of elapsedMsKeys) {
      if (descriptor[key] == null) {
        continue;
      }
      const numeric = Number(descriptor[key]);
      if (Number.isFinite(numeric) && Number.isFinite(referenceSimTime)) {
        return referenceSimTime - numeric;
      }
    }

    const elapsedTickKeys = ['elapsedTicks', 'elapsed_ticks'];
    for (const key of elapsedTickKeys) {
      if (descriptor[key] == null) {
        continue;
      }
      const numeric = Number(descriptor[key]);
      if (Number.isFinite(numeric) && Number.isFinite(referenceSimTime)) {
        const elapsedMs = Number.isFinite(tickDurationMs) && tickDurationMs > 0 ? numeric * tickDurationMs : numeric;
        return referenceSimTime - elapsedMs;
      }
    }

    const progress = Number(descriptor.progress);
    if (Number.isFinite(progress) && durationMs > 0 && Number.isFinite(referenceSimTime)) {
      const clamped = clamp01(progress);
      return referenceSimTime - clamped * durationMs;
    }

    return Number.isFinite(referenceSimTime) ? referenceSimTime : this._getCurrentSimTimeMs();
  }

  _createSnapshotPulseAppearance(strength, descriptor = null) {
    const ratio = clamp01(Number(strength));
    const incomingAppearance =
      descriptor && typeof descriptor.appearance === 'object' ? { ...descriptor.appearance } : {};

    const family = descriptor?.family ?? incomingAppearance.family ?? null;
    const theme = resolvePulseFamilyTheme(family);
    const result = { ...incomingAppearance };
    result.family = family ?? theme.family ?? 'default';

    const baseColor = descriptor?.color ?? result.color ?? theme.color ?? PARTICLE_COLOR;
    result.color = baseColor;

    const rawBrightness = descriptor?.brightness ?? result.brightness ?? 1;
    const brightness = clamp(rawBrightness, 0.1, 2.5);
    result.brightness = brightness;

    const sizeBoost = descriptor?.sizeBoost ?? result.sizeBoost ?? 0;
    result.sizeBoost = sizeBoost;
    const baseSize =
      descriptor?.size ?? result.size ?? PARTICLE_BASE_SIZE + ratio * PARTICLE_SIZE_RANGE;
    let finalSize = Number.isFinite(baseSize) ? baseSize + sizeBoost : PARTICLE_BASE_SIZE;
    if (!Number.isFinite(finalSize) || finalSize < PARTICLE_MIN_SIZE) {
      finalSize = PARTICLE_MIN_SIZE;
    }
    result.size = finalSize;

    const baseOpacity =
      descriptor?.opacity ?? result.opacity ?? PARTICLE_BASE_OPACITY + ratio * PARTICLE_OPACITY_RANGE;
    const opacityBoost = descriptor?.opacityBoost ?? result.opacityBoost ?? 0;
    result.opacityBoost = opacityBoost;
    let finalOpacity = clamp(baseOpacity + opacityBoost, PARTICLE_MIN_OPACITY, PARTICLE_MAX_OPACITY);
    finalOpacity = clamp(finalOpacity * brightness, PARTICLE_MIN_OPACITY, PARTICLE_MAX_OPACITY);
    result.opacity = finalOpacity;

    const glowStrengthSource =
      descriptor?.glowStrength ?? descriptor?.glow ?? result.glowStrength ?? result.glow ?? 0;
    const normalizedGlow = clamp(glowStrengthSource, 0, 2);
    const glowColor = descriptor?.glowColor ?? result.glowColor ?? theme.glowColor ?? baseColor;
    const glowOpacityBase =
      descriptor?.glowOpacity ?? result.glowOpacity ?? Math.min(0.82, 0.38 + normalizedGlow * 0.28);
    const glowSizeBase = descriptor?.glowSize ?? result.glowSize ?? finalSize * (2.2 + normalizedGlow * 0.6);

    if (normalizedGlow > 0 || descriptor?.glowColor || result.glowColor || theme.glowColor) {
      result.glowStrength = normalizedGlow;
      result.glow = normalizedGlow;
      result.glowColor = glowColor;
      result.glowOpacity = clamp(glowOpacityBase * brightness, 0.12, 0.9);
      result.glowSize = Math.max(finalSize * 1.8, glowSizeBase);
    } else {
      result.glowStrength = undefined;
      result.glow = undefined;
      result.glowColor = undefined;
      result.glowOpacity = undefined;
      result.glowSize = undefined;
    }

    const trailColor = descriptor?.trailColor ?? result.trailColor ?? null;
    const trailWidth =
      descriptor?.trailWidth ?? result.trailWidth ?? (normalizedGlow > 0.75 ? 1.6 : normalizedGlow > 0.35 ? 1.25 : null);
    if (trailColor) {
      result.trailColor = trailColor;
      result.trailWidth = trailWidth ?? 1.15;
    } else {
      result.trailColor = undefined;
      result.trailWidth = undefined;
    }

    return result;
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
      const color = appearance.color ?? PARTICLE_COLOR;
      const loadRatio = Number.isFinite(pulse.loadRatio) ? Math.max(0, pulse.loadRatio) : 0;
      const rateRatio = Number.isFinite(pulse.rateRatio) ? Math.max(0, pulse.rateRatio) : 0;
      const limitedLoad = Math.min(loadRatio, PULSE_VIEWER_MAX_LOAD_RATIO);
      const limitedRate = Math.min(rateRatio, PULSE_VIEWER_MAX_RATE_RATIO);
      const baseBrightness = clamp(appearance.brightness ?? 1, 0.12, 2.6);
      const brightness = clamp(
        baseBrightness * (1 + limitedRate * PARTICLE_RATE_BRIGHTNESS_MULTIPLIER + limitedLoad * 0.12),
        0.12,
        3,
      );
      const baseSize = Math.max(PARTICLE_MIN_SIZE, appearance.size ?? PARTICLE_BASE_SIZE);
      const sizeBoostFactor = 1 + limitedLoad * PARTICLE_LOAD_SIZE_MULTIPLIER;
      const sizeCap = PARTICLE_BASE_SIZE + PARTICLE_SIZE_RANGE * (1 + limitedLoad * 0.35);
      const size = clamp(baseSize * sizeBoostFactor, PARTICLE_MIN_SIZE, sizeCap);
      const strength = clamp01(pulse.strength ?? 0.6);
      const defaultOpacity = clamp(
        PARTICLE_BASE_OPACITY + strength * PARTICLE_OPACITY_RANGE,
        PARTICLE_MIN_OPACITY,
        PARTICLE_MAX_OPACITY,
      );
      let opacity = appearance.opacity ?? defaultOpacity;
      opacity = clamp(opacity * (1 + limitedLoad * PARTICLE_LOAD_OPACITY_MULTIPLIER), PARTICLE_MIN_OPACITY, PARTICLE_MAX_OPACITY);
      opacity = clamp(opacity * brightness, PARTICLE_MIN_OPACITY, PARTICLE_MAX_OPACITY);
      const baseGlowStrength = appearance.glowStrength ?? appearance.glow ?? 0;
      const enhancedGlowStrength = clamp(
        baseGlowStrength + limitedLoad * PARTICLE_LOAD_GLOW_MULTIPLIER + limitedRate * PARTICLE_RATE_GLOW_MULTIPLIER,
        0,
        3,
      );
      const glowOpacity = appearance.glowOpacity
        ? clamp(appearance.glowOpacity * brightness, 0.05, 0.95)
        : Math.min(0.85, opacity * (0.35 + enhancedGlowStrength * 0.35));
      const glowSize = Math.max(
        size * (1.8 + limitedLoad * 0.5),
        appearance.glowSize ?? size * (2 + enhancedGlowStrength),
      );
      ctx.save();
      if (appearance.trailColor && appearance.trailWidth) {
        const trailFactor = Math.min(0.18, 0.08 + limitedRate * 0.05);
        const trailT = Math.max(0, t - trailFactor);
        const trailX = segment.from.x + (segment.to.x - segment.from.x) * trailT;
        const trailY = segment.from.y + (segment.to.y - segment.from.y) * trailT;
        ctx.strokeStyle = appearance.trailColor;
        const trailWidth = clamp(
          appearance.trailWidth * (1 + limitedRate * 0.65 + limitedLoad * 0.15),
          0.4,
          3.2,
        );
        ctx.lineWidth = trailWidth;
        ctx.globalAlpha = Math.min(0.78, opacity * (0.85 + limitedRate * 0.1));
        ctx.beginPath();
        ctx.moveTo(trailX, trailY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      if (appearance.glowColor && glowSize > size) {
        ctx.fillStyle = appearance.glowColor;
        ctx.globalAlpha = Math.min(glowOpacity, opacity * 0.8);
        ctx.beginPath();
        ctx.arc(x, y, glowSize, 0, Math.PI * 2);
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
      const weightMagnitude = Math.max(0, segment.weight ?? 0);
      const adjustment = Number(segment.adjustment ?? 0);
      const adjustmentRatio = Math.min(1, Math.abs(adjustment) / EDGE_ADJUSTMENT_MAX);
      const hasAdjustment = adjustmentRatio > 0;
      const isPotentiated = adjustment > 0;
      const isSuppressed = adjustment < 0;
      const kind = segment.kind ?? 'base';
      const isTrace = kind === 'trace';
      const isJump = kind === 'jump';

      let strokeColor = EDGE_COLOR;
      if (isTrace) {
        strokeColor = TRACE_EDGE_COLOR;
      } else if (isPotentiated) {
        strokeColor = EDGE_POTENTIATION_COLOR;
      } else if (isSuppressed) {
        strokeColor = EDGE_DEPRESSION_COLOR;
      }

      let alpha = 0.45 + Math.min(0.35, weightMagnitude * 0.25);
      if (isTrace) {
        alpha = 0.55 + Math.min(0.35, weightMagnitude * 0.3);
      } else if (hasAdjustment) {
        alpha = Math.max(alpha, 0.45 + adjustmentRatio * 0.45);
      }
      if (isDecision) {
        alpha = Math.min(1, 0.7 + pulse * 0.6);
      }

      let lineWidth = 1.6 + weightMagnitude * 0.6;
      if (isTrace) {
        lineWidth = 2.2 + weightMagnitude * 0.5;
      } else if (hasAdjustment) {
        lineWidth += adjustmentRatio * 1.2;
      }
      if (isDecision) {
        lineWidth = Math.max(lineWidth, 3 + adjustmentRatio * 1.2);
      }

      if (isTrace) {
        ctx.setLineDash(TRACE_EDGE_DASH);
      } else if (isJump) {
        ctx.setLineDash([4, 6]);
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = isDecision ? EDGE_DECISION_COLOR : strokeColor;
      ctx.beginPath();
      ctx.moveTo(segment.from.x, segment.from.y);
      ctx.lineTo(segment.to.x, segment.to.y);
      ctx.stroke();
      if (isTrace) {
        ctx.globalAlpha = Math.min(0.6, alpha * 0.75);
        ctx.strokeStyle = TRACE_EDGE_GLOW;
        ctx.lineWidth = lineWidth + 2;
        ctx.beginPath();
        ctx.moveTo(segment.from.x, segment.from.y);
        ctx.lineTo(segment.to.x, segment.to.y);
        ctx.stroke();
      } else if (isDecision || hasAdjustment) {
        const glowStrength = isDecision ? pulse : adjustmentRatio;
        ctx.globalAlpha = isDecision ? 0.45 * pulse : 0.35 + glowStrength * 0.25;
        ctx.strokeStyle = isDecision
          ? EDGE_DECISION_GLOW
          : isPotentiated
            ? EDGE_POTENTIATION_GLOW
            : EDGE_DEPRESSION_GLOW;
        ctx.lineWidth = isDecision ? lineWidth + 4 : lineWidth + 2;
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
        const wedgeRadius = Math.max(3, radius - 1);
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + fillRatio * Math.PI * 2;
        ctx.beginPath();
        ctx.strokeStyle = isCurrent ? 'rgba(250, 204, 21, 0.75)' : 'rgba(56, 189, 248, 0.65)';
        ctx.lineWidth = isCurrent ? 3 : 2.6;
        ctx.globalAlpha = 0.6 + fillRatio * 0.3;
        ctx.arc(position.x, position.y, wedgeRadius, startAngle, endAngle, false);
        ctx.stroke();
      }
      ctx.lineWidth = isCurrent ? 2 : 1.5;
      ctx.strokeStyle = isCurrent ? NODE_HIGHLIGHT_STROKE : NODE_STROKE;
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (!isCurrent && this._nextFillNodeId === node.id && fillRatio > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(position.x, position.y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
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
