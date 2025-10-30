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
      while (edgeState.adjustment > 0 && currentTick >= edgeState.nextDecayTick) {
        edgeState.adjustment = Math.max(0, edgeState.adjustment - DECAY_STEP);
        edgeState.nextDecayTick += DECAY_INTERVAL_TICKS;

        if (edgeState.adjustment <= MIN_ADJUSTMENT) {
          emptiedTargets.push(targetId);
          break;
        }
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
  if (!sourceNodeId || !targetNodeId) {
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
    existing.adjustment = Math.min(MAX_ADJUSTMENT, existing.adjustment + REINFORCEMENT_INCREMENT);
    existing.nextDecayTick = currentTick + DECAY_DELAY_TICKS;
  } else {
    targetMap.set(targetNodeId, {
      adjustment: Math.min(REINFORCEMENT_INCREMENT, MAX_ADJUSTMENT),
      usageCount: 1,
      nextDecayTick: currentTick + DECAY_DELAY_TICKS,
    });
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
