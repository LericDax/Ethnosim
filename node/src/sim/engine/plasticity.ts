const REINFORCEMENT_INCREMENT = 0.05;
const MAX_ADJUSTMENT = 1;
const DECAY_DELAY_TICKS = 12;
const DECAY_INTERVAL_TICKS = 4;
const DECAY_STEP = 0.02;
const MIN_ADJUSTMENT = 0.001;

export interface PlasticityEdgeState {
  adjustment: number;
  usageCount: number;
  nextDecayTick: number;
}

export interface SerializedPlasticityEdgeState {
  adjustment: number;
  usageCount: number;
  nextDecayTick: number;
}

export interface SerializedPlasticityState {
  tick: number;
  edges: Record<string, Record<string, SerializedPlasticityEdgeState>>;
}

export interface PlasticityState {
  tick: number;
  edges: Map<string, Map<string, PlasticityEdgeState>>;
}

export function createPlasticityState(): PlasticityState {
  return {
    tick: 0,
    edges: new Map(),
  };
}

export function advancePlasticityState(state: PlasticityState): void {
  state.tick += 1;
  const currentTick = state.tick;

  const emptySources: string[] = [];
  for (const [sourceId, targetMap] of state.edges.entries()) {
    const emptiedTargets: string[] = [];
    for (const [targetId, edgeState] of targetMap.entries()) {
      while (edgeState.adjustment !== 0 && currentTick >= edgeState.nextDecayTick) {
        const magnitude = Math.max(0, Math.abs(edgeState.adjustment) - DECAY_STEP);
        const nextValue = magnitude > 0 ? Math.sign(edgeState.adjustment) * magnitude : 0;
        edgeState.nextDecayTick += DECAY_INTERVAL_TICKS;

        if (Math.abs(nextValue) <= MIN_ADJUSTMENT) {
          edgeState.adjustment = 0;
          emptiedTargets.push(targetId);
          break;
        }

        edgeState.adjustment = nextValue;
      }
    }

    for (const targetId of emptiedTargets) {
      targetMap.delete(targetId);
    }

    if (targetMap.size === 0) {
      emptySources.push(sourceId);
    }
  }

  for (const sourceId of emptySources) {
    state.edges.delete(sourceId);
  }
}

export function registerPlasticityTransition(
  state: PlasticityState,
  sourceNodeId: string,
  targetNodeId: string,
): void {
  registerPlasticityOutcome(state, sourceNodeId, targetNodeId, 1);
}

export function registerPlasticityOutcome(
  state: PlasticityState,
  sourceNodeId: string,
  targetNodeId: string,
  reward: number,
): void {
  if (!sourceNodeId || !targetNodeId || !Number.isFinite(reward) || reward === 0) {
    return;
  }

  const normalizedReward = Math.max(-1, Math.min(1, reward));
  const delta = normalizedReward * REINFORCEMENT_INCREMENT;
  if (delta === 0) {
    return;
  }

  let targetMap = state.edges.get(sourceNodeId);
  if (!targetMap) {
    targetMap = new Map();
    state.edges.set(sourceNodeId, targetMap);
  }

  const currentTick = state.tick;
  const existing = targetMap.get(targetNodeId);
  if (existing) {
    existing.usageCount += 1;
    const nextValue = clampSymmetric(existing.adjustment + delta, MAX_ADJUSTMENT);
    if (Math.abs(nextValue) <= MIN_ADJUSTMENT) {
      targetMap.delete(targetNodeId);
    } else {
      existing.adjustment = nextValue;
      existing.nextDecayTick = currentTick + DECAY_DELAY_TICKS;
    }
  } else {
    const adjustment = clampSymmetric(delta, MAX_ADJUSTMENT);
    if (Math.abs(adjustment) <= MIN_ADJUSTMENT) {
      return;
    }
    targetMap.set(targetNodeId, {
      adjustment,
      usageCount: 1,
      nextDecayTick: currentTick + DECAY_DELAY_TICKS,
    });
  }

  if (targetMap.size === 0) {
    state.edges.delete(sourceNodeId);
  }
}

export function applyPlasticityToWeight(
  state: PlasticityState,
  sourceNodeId: string,
  targetNodeId: string,
  baseWeight: number,
): number {
  const targetMap = state.edges.get(sourceNodeId);
  if (!targetMap) {
    return baseWeight;
  }
  const edgeState = targetMap.get(targetNodeId);
  if (!edgeState) {
    return baseWeight;
  }
  const adjusted = baseWeight + edgeState.adjustment;
  return adjusted > 0 ? adjusted : 0;
}

function clampSymmetric(value: number, limit: number): number {
  if (value > limit) {
    return limit;
  }
  if (value < -limit) {
    return -limit;
  }
  return value;
}
