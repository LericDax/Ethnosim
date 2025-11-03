import type { AgentState, SimulationState } from '../sim.worker.ts';
import type { ResourceType } from './resources.ts';
import type { CollectiveLeaderDescriptor } from './collectives.ts';

export type RelationshipMetric = 'trust' | 'rivalry' | 'obligation';

export interface RelationshipWeights {
  trust: number;
  rivalry: number;
  obligation: number;
}

export type RelationshipEventType =
  | 'coHousing'
  | 'sharedWork'
  | 'leadership'
  | 'demandConflict'
  | 'family';

export interface RelationshipEvent {
  tick: number;
  targetId: string;
  type: RelationshipEventType;
  delta: Partial<RelationshipWeights>;
  note?: string;
}

export interface RelationshipState {
  weights: Record<string, RelationshipWeights>;
  events: RelationshipEvent[];
  lastEvaluatedTick: number;
}

const MAX_EVENT_LOG = 16;
const RELATIONSHIP_DECAY = 0.015;
const MIN_EFFECT_THRESHOLD = 1e-3;
const WEIGHT_CLAMP = 2;
const DEMAND_MOOD_MAX = 3;
const DEMAND_MOOD_MIN = 0;
const DEMAND_MOOD_EPSILON = 1e-3;

export function createInitialRelationshipState(): RelationshipState {
  return {
    weights: {},
    events: [],
    lastEvaluatedTick: 0,
  };
}

export function ensureRelationshipState(agent: AgentState): RelationshipState {
  if (!agent.relationships) {
    agent.relationships = createInitialRelationshipState();
  }
  return agent.relationships;
}

export function decayRelationshipState(agent: AgentState, tick: number): void {
  const state = ensureRelationshipState(agent);
  if (state.lastEvaluatedTick === tick) {
    return;
  }
  for (const weights of Object.values(state.weights)) {
    weights.trust = decayTowardsZero(weights.trust);
    weights.rivalry = decayTowardsZero(weights.rivalry);
    weights.obligation = decayTowardsZero(weights.obligation);
  }
  state.lastEvaluatedTick = tick;
  updateRelationshipMultipliers(agent);
}

export function recordCoHousingInteractions(simulation: SimulationState): void {
  if (simulation.houses.length === 0) {
    return;
  }
  const agentMap = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    agentMap.set(agent.id, agent);
  }
  for (const house of simulation.houses) {
    if (!house.members || house.members.length <= 1) {
      continue;
    }
    const members: AgentState[] = [];
    for (const memberId of house.members) {
      const member = agentMap.get(memberId);
      if (member) {
        members.push(member);
      }
    }
    if (members.length <= 1) {
      continue;
    }
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        applyRelationshipDelta(
          a,
          b,
          {
            trust: 0.02,
            rivalry: -0.015,
            obligation: 0.01,
          },
          simulation.tick,
          'coHousing',
          `house:${house.id}`,
        );
      }
    }
  }
}

export function registerSharedWorkWithHouse(
  simulation: SimulationState,
  agent: AgentState,
  houseMemberIds: readonly string[] | undefined,
  amount: number,
  resource: ResourceType,
): void {
  if (!houseMemberIds || houseMemberIds.length === 0) {
    return;
  }
  if (amount <= 0) {
    return;
  }
  const magnitude = Math.min(0.25, amount * 0.04);
  const agentMap = new Map<string, AgentState>();
  for (const entry of simulation.agents) {
    agentMap.set(entry.id, entry);
  }
  for (const memberId of houseMemberIds) {
    if (memberId === agent.id) {
      continue;
    }
    const member = agentMap.get(memberId);
    if (!member) {
      continue;
    }
    applyRelationshipDelta(
      agent,
      member,
      {
        trust: magnitude,
        obligation: magnitude * 0.65,
        rivalry: -magnitude * 0.3,
      },
      simulation.tick,
      'sharedWork',
      `resource:${resource}`,
    );
  }
}

export function registerSharedWorkWithCity(
  simulation: SimulationState,
  agent: AgentState,
  leaders: readonly CollectiveLeaderDescriptor[] | null | undefined,
  amount: number,
  resource: ResourceType,
): void {
  if (!leaders || leaders.length === 0 || amount <= 0) {
    return;
  }
  const magnitude = Math.min(0.2, amount * 0.035);
  const agentMap = new Map<string, AgentState>();
  for (const entry of simulation.agents) {
    agentMap.set(entry.id, entry);
  }
  for (const leader of leaders) {
    const leaderAgent = agentMap.get(leader.agentId);
    applyRelationshipDelta(
      agent,
      leaderAgent ?? null,
      {
        trust: magnitude * 0.6,
        obligation: magnitude,
        rivalry: -magnitude * 0.2,
      },
      simulation.tick,
      'sharedWork',
      `city:${leader.agentId}`,
    );
  }
}

export function registerLeadershipSelectionRelationships(
  agentMap: Map<string, AgentState>,
  leaders: readonly CollectiveLeaderDescriptor[] | null | undefined,
  members: readonly AgentState[],
  scope: 'house' | 'city',
  tick: number,
): void {
  if (!leaders || leaders.length === 0 || members.length === 0) {
    return;
  }
  for (const leader of leaders) {
    const leaderAgent = agentMap.get(leader.agentId) ?? null;
    const support = Math.max(0, Math.min(1, leader.support ?? 0));
    const trustDelta = 0.12 + support * 0.18;
    const obligationDelta = 0.08 + support * 0.12;
    const rivalryDelta = support < 0.25 ? (0.25 - support) * 0.12 : -support * 0.08;
    for (const member of members) {
      if (leaderAgent && member.id === leaderAgent.id) {
        continue;
      }
      applyRelationshipDelta(
        member,
        leaderAgent,
        {
          trust: trustDelta,
          obligation: obligationDelta,
          rivalry: rivalryDelta,
        },
        tick,
        'leadership',
        `${scope}:${leader.agentId}`,
      );
    }
  }
}

export function registerDemandPressure(
  agent: AgentState,
  leader: AgentState | null,
  intensity: number,
  scope: 'house' | 'city',
  conflict: boolean,
  tick: number,
): void {
  if (intensity <= MIN_EFFECT_THRESHOLD) {
    return;
  }
  const trustDelta = scope === 'house' ? intensity * 0.06 : intensity * 0.04;
  const obligationDelta = intensity * 0.16;
  const rivalryDelta = conflict ? intensity * 0.12 : -intensity * 0.05;
  const targetLeader = leader && leader.id === agent.id ? null : leader;
  applyRelationshipDelta(
    agent,
    targetLeader,
    {
      trust: trustDelta,
      obligation: obligationDelta,
      rivalry: rivalryDelta,
    },
    tick,
    conflict ? 'demandConflict' : 'leadership',
    `${scope}:demand`,
  );

  const isTeen = agent.lifeStage === 'teen';
  const isAdult = agent.lifeStage === 'adult';
  if (isTeen || isAdult) {
    const loyaltyFocus = isTeen ? 1.35 : 1.15;
    const homeFocus = isAdult ? 1.4 : 0.95;
    const dutyFocus = isAdult ? 1.3 : 1.05;
    const conflictPenalty = conflict ? 0.75 : 1;
    const loyaltyScope = scope === 'city' ? 1.1 : 0.85;
    const homeScope = scope === 'house' ? 1.4 : 0.7;
    const dutyScope = scope === 'house' ? 1.15 : 1;

    applyDemandMoodPulse(agent, 'loyalty', intensity * 0.18 * loyaltyFocus * loyaltyScope * conflictPenalty);
    applyDemandMoodPulse(agent, 'home', intensity * 0.22 * homeFocus * homeScope);
    applyDemandMoodPulse(agent, 'duty', intensity * 0.2 * dutyFocus * dutyScope * conflictPenalty);
  }
}

export function registerPregnancyBond(
  gestator: AgentState,
  partner: AgentState,
  tick: number,
): void {
  applyRelationshipDelta(
    gestator,
    partner,
    {
      trust: 0.3,
      obligation: 0.25,
      rivalry: -0.2,
    },
    tick,
    'family',
    'pregnancy',
  );
}

export function registerBirthBond(
  simulation: SimulationState,
  parent: AgentState,
  coParent: AgentState | null,
  child: AgentState,
): void {
  applyRelationshipDelta(
    parent,
    child,
    {
      trust: 0.35,
      obligation: 0.28,
      rivalry: -0.2,
    },
    simulation.tick,
    'family',
    'birth',
  );
  if (coParent) {
    applyRelationshipDelta(
      coParent,
      child,
      {
        trust: 0.3,
        obligation: 0.22,
        rivalry: -0.18,
      },
      simulation.tick,
      'family',
      'birth',
    );
    applyRelationshipDelta(
      parent,
      coParent,
      {
        trust: 0.18,
        obligation: 0.14,
        rivalry: -0.1,
      },
      simulation.tick,
      'family',
      'birth',
    );
  }
  ensureRelationshipState(child);
  updateRelationshipMultipliers(child);
}

export function updateRelationshipMultipliers(agent: AgentState): void {
  const state = ensureRelationshipState(agent);
  const multipliers: Record<string, number> = {};
  let trustTotal = 0;
  let trustCount = 0;
  let obligationTotal = 0;
  let rivalryPeak = 0;
  let homeMultiplier = 1;
  let buildMultiplier = 1;
  for (const weights of Object.values(state.weights)) {
    if (weights.trust > MIN_EFFECT_THRESHOLD) {
      trustTotal += weights.trust;
      trustCount += 1;
    }
    if (weights.obligation > MIN_EFFECT_THRESHOLD) {
      obligationTotal += weights.obligation;
    }
    if (weights.rivalry > rivalryPeak) {
      rivalryPeak = weights.rivalry;
    }
  }
  const avgTrust = trustCount > 0 ? trustTotal / trustCount : 0;
  const obligation = Math.max(0, obligationTotal);
  const rivalry = Math.max(0, rivalryPeak);
  if (avgTrust > MIN_EFFECT_THRESHOLD) {
    const scaled = Math.min(1.2, avgTrust);
    multipliers.social = 1 + scaled * 0.4;
    multipliers.care = 1 + scaled * 0.3;
    multipliers.loyalty = 1 + scaled * 0.28;
    homeMultiplier *= 1 + scaled * 0.2;
    buildMultiplier *= 1 + scaled * 0.24;
  }
  if (obligation > MIN_EFFECT_THRESHOLD) {
    const scaled = Math.min(1.5, obligation);
    multipliers.duty = 1 + scaled * 0.5;
    homeMultiplier *= 1 + scaled * 0.45;
    buildMultiplier *= 1 + scaled * 0.35;
  }
  if (rivalry > MIN_EFFECT_THRESHOLD) {
    const scaled = Math.min(1, rivalry);
    multipliers.guard = 1 + scaled * 0.5;
    multipliers.fear = 1 + scaled * 0.35;
  }
  if (homeMultiplier > 1) {
    multipliers.home = homeMultiplier;
  }
  if (buildMultiplier > 1) {
    multipliers.build = buildMultiplier;
  }
  agent.brainMultipliers.relationship = multipliers;
}

function applyRelationshipDelta(
  agent: AgentState,
  target: AgentState | null,
  delta: Partial<RelationshipWeights>,
  tick: number,
  type: RelationshipEventType,
  note?: string,
): void {
  if (!agent || !delta) {
    return;
  }
  const targetId = target ? target.id : note ?? 'unknown';
  const state = ensureRelationshipState(agent);
  const weights = ensureWeights(state, target ? target.id : targetId);
  let changed = false;
  if (typeof delta.trust === 'number' && Number.isFinite(delta.trust) && delta.trust !== 0) {
    weights.trust = clampWeight(weights.trust + delta.trust);
    if (Math.abs(weights.trust) < MIN_EFFECT_THRESHOLD) {
      weights.trust = 0;
    }
    changed = true;
  }
  if (typeof delta.rivalry === 'number' && Number.isFinite(delta.rivalry) && delta.rivalry !== 0) {
    weights.rivalry = clampWeight(weights.rivalry + delta.rivalry);
    if (Math.abs(weights.rivalry) < MIN_EFFECT_THRESHOLD) {
      weights.rivalry = 0;
    }
    changed = true;
  }
  if (
    typeof delta.obligation === 'number' &&
    Number.isFinite(delta.obligation) &&
    delta.obligation !== 0
  ) {
    weights.obligation = clampWeight(weights.obligation + delta.obligation);
    if (Math.abs(weights.obligation) < MIN_EFFECT_THRESHOLD) {
      weights.obligation = 0;
    }
    changed = true;
  }
  if (changed) {
    pushEvent(state, {
      tick,
      targetId,
      type,
      delta,
      note,
    });
    updateRelationshipMultipliers(agent);
  }
  if (target) {
    applyRelationshipDeltaMirror(target, agent, delta, tick, type, note);
  }
}

function applyRelationshipDeltaMirror(
  agent: AgentState,
  source: AgentState,
  delta: Partial<RelationshipWeights>,
  tick: number,
  type: RelationshipEventType,
  note?: string,
): void {
  const mirrored: Partial<RelationshipWeights> = {
    trust: delta.trust,
    obligation: delta.obligation ? delta.obligation * 0.9 : undefined,
    rivalry: delta.rivalry,
  };
  const state = ensureRelationshipState(agent);
  const weights = ensureWeights(state, source.id);
  let changed = false;
  if (typeof mirrored.trust === 'number' && mirrored.trust !== 0) {
    weights.trust = clampWeight(weights.trust + mirrored.trust);
    if (Math.abs(weights.trust) < MIN_EFFECT_THRESHOLD) {
      weights.trust = 0;
    }
    changed = true;
  }
  if (typeof mirrored.obligation === 'number' && mirrored.obligation !== 0) {
    weights.obligation = clampWeight(weights.obligation + mirrored.obligation);
    if (Math.abs(weights.obligation) < MIN_EFFECT_THRESHOLD) {
      weights.obligation = 0;
    }
    changed = true;
  }
  if (typeof mirrored.rivalry === 'number' && mirrored.rivalry !== 0) {
    weights.rivalry = clampWeight(weights.rivalry + mirrored.rivalry);
    if (Math.abs(weights.rivalry) < MIN_EFFECT_THRESHOLD) {
      weights.rivalry = 0;
    }
    changed = true;
  }
  if (changed) {
    pushEvent(state, {
      tick,
      targetId: source.id,
      type,
      delta: mirrored,
      note,
    });
    updateRelationshipMultipliers(agent);
  }
}

function ensureWeights(state: RelationshipState, targetId: string): RelationshipWeights {
  const existing = state.weights[targetId];
  if (existing) {
    return existing;
  }
  const created: RelationshipWeights = { trust: 0, rivalry: 0, obligation: 0 };
  state.weights[targetId] = created;
  return created;
}

function pushEvent(state: RelationshipState, event: RelationshipEvent): void {
  state.events.push(event);
  if (state.events.length > MAX_EVENT_LOG) {
    state.events.splice(0, state.events.length - MAX_EVENT_LOG);
  }
}

function decayTowardsZero(value: number): number {
  if (Math.abs(value) < MIN_EFFECT_THRESHOLD) {
    return 0;
  }
  return value * (1 - RELATIONSHIP_DECAY);
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value > WEIGHT_CLAMP) {
    return WEIGHT_CLAMP;
  }
  if (value < -WEIGHT_CLAMP) {
    return -WEIGHT_CLAMP;
  }
  return value;
}

function applyDemandMoodPulse(agent: AgentState, key: string, delta: number): void {
  if (!Number.isFinite(delta) || Math.abs(delta) < DEMAND_MOOD_EPSILON) {
    return;
  }
  if (!agent.moods) {
    agent.moods = {};
  }
  const current = Number.isFinite(agent.moods[key]) ? Number(agent.moods[key]) : 0;
  const next = clampDemandMood(current + delta);
  if (next <= DEMAND_MOOD_EPSILON) {
    if (key in agent.moods) {
      delete agent.moods[key];
    }
    return;
  }
  agent.moods[key] = next;
}

function clampDemandMood(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < DEMAND_MOOD_MIN) {
    return DEMAND_MOOD_MIN;
  }
  if (value > DEMAND_MOOD_MAX) {
    return DEMAND_MOOD_MAX;
  }
  return value;
}
