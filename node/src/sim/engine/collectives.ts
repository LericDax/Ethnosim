import {
  createBrainState,
  tickBrain,
  getNodeMetadata,
  type BrainDecision,
  type BrainState,
} from './brain.ts';
import type { BrainMultiplierSet } from './brain.ts';
import type { RngStream } from './rng.ts';

const HOUSE_MIND_ID = 'HouseMind_v1';
const HOUSE_NODE_DURATION = 12;
const CITY_MIND_ID = 'UrbanMind_v1';
const CITY_RADIUS_FACTOR = 0.35;

export type ResourceType = 'wood';

export type ResourceBundle = Partial<Record<ResourceType, number>>;

export interface HouseConstructionState {
  active: boolean;
  progress: number;
  required: number;
  cooldownUntil: number;
}

export const HOUSE_CONSTRUCTION_COST = 24;
export const HOUSE_CONSTRUCTION_RETRY_DELAY = 12;
export const HOUSE_CONSTRUCTION_COOLDOWN = 24;

type LifeStage = 'baby' | 'child' | 'teen' | 'adult';

type TemperamentProfile = {
  trustBias: number;
  fearBias: number;
  loyaltyBias: number;
  resentmentBias: number;
  territorialBias: number;
  zealBias: number;
};

export interface CollectiveLeaderDescriptor {
  agentId: string;
  role: string;
  title: string;
  score: number;
  support: number;
  method: 'temperament' | 'traits' | 'votes' | 'tie-break';
  temperament: TemperamentProfile;
  traitFlags: string[];
  selectedAtTick: number;
  notes?: string;
}

interface LeadershipSelectionContext {
  currentTick: number;
  rng?: RngStream | null;
}

interface HouseDemandTemplate {
  nodeId: string;
  tagMultipliers: Record<string, number>;
}

const HOUSE_DEMAND_TEMPLATES: Record<string, HouseDemandTemplate> = {
  FortifyHome: {
    nodeId: 'FortifyHome',
    tagMultipliers: {
      home: 1.3,
      defense: 1.2,
      build: 1.1,
    },
  },
  ProtectYoung: {
    nodeId: 'ProtectYoung',
    tagMultipliers: {
      care: 1.4,
      defense: 1.15,
      safety: 1.35,
    },
  },
  NurtureHeir: {
    nodeId: 'NurtureHeir',
    tagMultipliers: {
      care: 1.25,
      future: 1.3,
      lineage: 1.2,
    },
  },
  EnsureLineage: {
    nodeId: 'EnsureLineage',
    tagMultipliers: {
      lineage: 1.35,
      strategy: 1.15,
      legacy: 1.25,
    },
  },
  AvengeSlight: {
    nodeId: 'AvengeSlight',
    tagMultipliers: {
      retaliation: 1.45,
      honor: 1.25,
      outward: 1.2,
    },
  },
  AccumulateStock: {
    nodeId: 'AccumulateStock',
    tagMultipliers: {
      resource: 1.4,
      stockpile: 1.3,
      home: 1.1,
    },
  },
};

export interface HouseAssignableAgent {
  id: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  houseId: string | null;
  brainMultipliers: BrainMultiplierSet;
  lifeStage: LifeStage;
  temperament: TemperamentProfile;
  traitFlags: string[];
}

export interface HouseState {
  id: string;
  x: number;
  y: number;
  radius: number;
  brain: BrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  members: string[];
  activeDemand: Record<string, number>;
  stockpiles: ResourceBundle;
  construction: HouseConstructionState;
  primaryLeaderId: string | null;
  leaders: CollectiveLeaderDescriptor[];
  leaderDirectives: Record<string, number>;
}

interface CityDemandTemplate {
  nodeId: string;
  tagMultipliers: Record<string, number>;
}

const CITY_DEMAND_TEMPLATES: Record<string, CityDemandTemplate> = {
  CollectTribute: {
    nodeId: 'CollectTribute',
    tagMultipliers: {
      loyalty: 1.3,
      duty: 1.2,
      authority: 1.15,
      resource: 1.1,
    },
  },
  MaintainOrder: {
    nodeId: 'MaintainOrder',
    tagMultipliers: {
      loyalty: 1.25,
      authority: 1.2,
      control: 1.2,
      discipline: 1.15,
    },
  },
  ProjectDoctrine: {
    nodeId: 'ProjectDoctrine',
    tagMultipliers: {
      ritual: 1.35,
      ideology: 1.25,
      loyalty: 1.2,
    },
  },
  AbsorbYouth: {
    nodeId: 'AbsorbYouth',
    tagMultipliers: {
      loyalty: 1.25,
      recruit: 1.3,
      youth: 1.2,
      social: 1.1,
    },
  },
  SanctifyBirth: {
    nodeId: 'SanctifyBirth',
    tagMultipliers: {
      ritual: 1.4,
      birth: 1.2,
      loyalty: 1.3,
      doctrine: 1.15,
    },
  },
  SuppressRivals: {
    nodeId: 'SuppressRivals',
    tagMultipliers: {
      loyalty: 1.2,
      authority: 1.2,
      conflict: 1.15,
    },
  },
};

export interface CityState {
  id: string;
  x: number;
  y: number;
  radius: number;
  brain: BrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  activeDemand: Record<string, number>;
  demandExpiresAt: number;
  stockpiles: ResourceBundle;
  primaryLeaderId: string | null;
  leaders: CollectiveLeaderDescriptor[];
  leaderDirectives: Record<string, number>;
}

interface HouseSpawnOptions {
  width: number;
  height: number;
  rng: RngStream;
  agents: HouseAssignableAgent[];
  desiredHouseCount?: number;
}

interface CitySpawnOptions {
  width: number;
  height: number;
  rng: RngStream;
}

interface HouseAssignmentOptions {
  currentTick?: number;
  rng?: RngStream | null;
}

const CITY_ELIGIBLE_STAGES: LifeStage[] = ['teen', 'adult'];
const HOUSE_ELIGIBLE_STAGES: LifeStage[] = ['teen', 'adult'];

const TEMPERAMENT_WEIGHTS: Record<keyof TemperamentProfile, number> = {
  loyaltyBias: 1.15,
  trustBias: 0.85,
  zealBias: 0.45,
  territorialBias: 0.35,
  fearBias: -0.9,
  resentmentBias: -0.65,
};

const TRAIT_PRIORITY: Record<string, number> = {
  steadfast: 0.9,
  visionary: 0.7,
  territorial: 0.4,
  resentful: -0.3,
};

const DIRECTIVE_TAG_WEIGHTS: Record<string, number> = {
  home: 0.05,
  defense: 0.08,
  loyalty: 0.1,
  duty: 0.08,
  build: 0.05,
  outward: 0.04,
};

const MAX_SECONDARY_LEADERS = 2;

export function createInitialHouses(options: HouseSpawnOptions): HouseState[] {
  const { width, height, rng, agents, desiredHouseCount } = options;
  const count = determineHouseCount(agents.length, desiredHouseCount);
  const houses: HouseState[] = [];
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxRadius = Math.min(width, height) * 0.2;

  for (let i = 0; i < count; i += 1) {
    const offsetRadius = Math.min(maxRadius, maxRadius * (0.8 + rng.nextFloat() * 0.4));
    const angle = rng.nextFloat() * Math.PI * 2;
    const x = clamp(centerX + Math.cos(angle) * offsetRadius, 0, width);
    const y = clamp(centerY + Math.sin(angle) * offsetRadius, 0, height);
    const radius = maxRadius * (0.6 + rng.nextFloat() * 0.6);
    houses.push(createHouseState(`house-${i}`, x, y, radius));
  }

  assignAgentsToHouses(houses, agents, { currentTick: 0, rng });
  return houses;
}

export function createHouseState(id: string, x: number, y: number, radius: number): HouseState {
  const brain = createBrainState(HOUSE_MIND_ID);

  return {
    id,
    x,
    y,
    radius,
    brain,
    brainNodeDuration: HOUSE_NODE_DURATION,
    brainDecision: null,
    members: [],
    activeDemand: {},
    stockpiles: { wood: 0 },
    construction: {
      active: false,
      progress: 0,
      required: HOUSE_CONSTRUCTION_COST,
      cooldownUntil: 0,
    },
    primaryLeaderId: null,
    leaders: [],
    leaderDirectives: {},
  };
}

export function createUrbanCenter(options: CitySpawnOptions): CityState {
  const { width, height, rng } = options;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const jitterRadius = Math.min(width, height) * 0.05;
  const jitterAngle = rng.nextFloat() * Math.PI * 2;
  const jitterDistance = jitterRadius * rng.nextFloat();
  const x = clamp(centerX + Math.cos(jitterAngle) * jitterDistance, 0, width);
  const y = clamp(centerY + Math.sin(jitterAngle) * jitterDistance, 0, height);
  const radius = Math.min(width, height) * CITY_RADIUS_FACTOR;

  const brain = createBrainState(CITY_MIND_ID);
  const metadata = getNodeMetadata(CITY_MIND_ID, brain.currentNodeId);
  const duration = metadata.duration || 72;
  const activeDemand = cloneCityDemand(metadata.id);

  return {
    id: 'city-0',
    x,
    y,
    radius,
    brain,
    brainNodeDuration: duration,
    brainDecision: null,
    activeDemand,
    demandExpiresAt: duration,
    stockpiles: { wood: 0 },
    primaryLeaderId: null,
    leaders: [],
    leaderDirectives: {},
  };
}

export function assignAgentsToHouses(
  houses: HouseState[],
  agents: HouseAssignableAgent[],
  options: HouseAssignmentOptions = {},
): void {
  if (houses.length === 0) {
    return;
  }

  const houseMap = new Map<string, HouseState>();
  for (const house of houses) {
    house.members = [];
    houseMap.set(house.id, house);
  }

  const agentMap = new Map<string, HouseAssignableAgent>();
  for (const agent of agents) {
    agentMap.set(agent.id, agent);
    let assignedHouse = agent.houseId ? houseMap.get(agent.houseId) ?? null : null;
    if (!assignedHouse) {
      assignedHouse = findNearestHouse(agent, houses);
      agent.houseId = assignedHouse?.id ?? null;
    }

    if (assignedHouse) {
      assignedHouse.members.push(agent.id);
    }
  }

  const context: LeadershipSelectionContext = {
    currentTick: options.currentTick ?? 0,
    rng: options.rng ?? null,
  };

  for (const house of houses) {
    updateHouseLeadership(house, agentMap, context);
  }
}

export function updateCollectiveDemands(
  houses: HouseState[],
  city: CityState | null,
  agents: HouseAssignableAgent[],
  currentTick: number,
  options: { rng?: RngStream | null } = {},
): void {
  if (agents.length === 0) {
    return;
  }

  const agentMap = new Map<string, HouseAssignableAgent>();
  for (const agent of agents) {
    agentMap.set(agent.id, agent);
    if (!agent.brainMultipliers.demand) {
      agent.brainMultipliers.demand = {};
    } else {
      for (const key of Object.keys(agent.brainMultipliers.demand)) {
        delete agent.brainMultipliers.demand[key];
      }
    }
  }

  if (city) {
    electCityLeadership(city, agents, {
      currentTick,
      rng: options.rng ?? null,
    });
    runCityScheduler(city, { currentTick, rng: options.rng ?? null });
    if (city.activeDemand && Object.keys(city.activeDemand).length > 0 && currentTick <= city.demandExpiresAt) {
      const radiusSq = city.radius * city.radius;
      for (const agent of agents) {
        if (!CITY_ELIGIBLE_STAGES.includes(agent.lifeStage)) {
          continue;
        }
        const dx = agent.x - city.x;
        const dy = agent.y - city.y;
        if (dx * dx + dy * dy > radiusSq) {
          continue;
        }
        const demand = agent.brainMultipliers.demand ?? (agent.brainMultipliers.demand = {});
        applyDemandMultipliers(demand, city.activeDemand);
        applyDemandMultipliers(demand, city.leaderDirectives);
      }
    }
  }

  for (const house of houses) {
    runHouseScheduler(house, { currentTick, rng: options.rng ?? null });
    if (house.members.length === 0) {
      continue;
    }
    const template = house.activeDemand;
    if (!template || Object.keys(template).length === 0) {
      continue;
    }

    for (const memberId of house.members) {
      const agent = agentMap.get(memberId);
      if (!agent) {
        continue;
      }
      const demand = agent.brainMultipliers.demand ?? (agent.brainMultipliers.demand = {});
      applyDemandMultipliers(demand, template);
      applyDemandMultipliers(demand, house.leaderDirectives);
    }
  }
}

interface LeadershipCandidateEvaluation {
  candidate: HouseAssignableAgent;
  score: number;
  support: number;
  method: 'temperament' | 'traits' | 'votes' | 'tie-break';
  notes: string[];
  temperamentScore: number;
  traitBonus: number;
}

function updateHouseLeadership(
  house: HouseState,
  agentMap: Map<string, HouseAssignableAgent>,
  context: LeadershipSelectionContext,
): void {
  if (house.members.length === 0) {
    house.primaryLeaderId = null;
    house.leaders = [];
    house.leaderDirectives = {};
    return;
  }

  const candidates: HouseAssignableAgent[] = [];
  for (const memberId of house.members) {
    const agent = agentMap.get(memberId);
    if (!agent) {
      continue;
    }
    if (!HOUSE_ELIGIBLE_STAGES.includes(agent.lifeStage)) {
      continue;
    }
    candidates.push(agent);
  }

  if (candidates.length === 0) {
    house.primaryLeaderId = null;
    house.leaders = [];
    house.leaderDirectives = {};
    return;
  }

  const evaluations = evaluateLeadershipSet(candidates, context);
  const sorted = sortLeadershipEvaluations(evaluations, context.rng);
  if (sorted.length === 0) {
    house.primaryLeaderId = null;
    house.leaders = [];
    house.leaderDirectives = {};
    return;
  }

  const previousPrimary = house.primaryLeaderId;
  const descriptorList: CollectiveLeaderDescriptor[] = [];
  const nowTick = context.currentTick;

  sorted.slice(0, MAX_SECONDARY_LEADERS + 1).forEach((evaluation, index) => {
    const role = index === 0 ? 'head-of-house' : `council-${index}`;
    const title = index === 0 ? 'House Head' : 'Councilor';
    const existing = house.leaders.find((leader) => leader.role === role && leader.agentId === evaluation.candidate.id);
    const selectedAtTick = existing ? existing.selectedAtTick : nowTick;
    descriptorList.push({
      agentId: evaluation.candidate.id,
      role,
      title,
      score: evaluation.score,
      support: evaluation.support,
      method: evaluation.method,
      temperament: { ...evaluation.candidate.temperament },
      traitFlags: [...evaluation.candidate.traitFlags],
      selectedAtTick,
      notes: evaluation.notes.join(' | ') || undefined,
    });
  });

  const primary = descriptorList[0] ?? null;
  house.primaryLeaderId = primary ? primary.agentId : null;
  if (primary && previousPrimary === primary.agentId) {
    primary.selectedAtTick =
      house.leaders.find((leader) => leader.role === primary.role && leader.agentId === primary.agentId)?.selectedAtTick ??
      primary.selectedAtTick;
  }

  house.leaders = descriptorList;
  house.leaderDirectives = buildLeaderDirectives(descriptorList, 'house');
}

function electCityLeadership(
  city: CityState,
  agents: HouseAssignableAgent[],
  context: LeadershipSelectionContext,
): void {
  const radiusSq = city.radius * city.radius;
  const candidates: HouseAssignableAgent[] = [];
  for (const agent of agents) {
    if (!CITY_ELIGIBLE_STAGES.includes(agent.lifeStage)) {
      continue;
    }
    const dx = agent.x - city.x;
    const dy = agent.y - city.y;
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }
    candidates.push(agent);
  }

  if (candidates.length === 0) {
    city.primaryLeaderId = null;
    city.leaders = [];
    city.leaderDirectives = {};
    return;
  }

  const evaluations = evaluateLeadershipSet(candidates, context);
  const sorted = sortLeadershipEvaluations(evaluations, context.rng);
  if (sorted.length === 0) {
    city.primaryLeaderId = null;
    city.leaders = [];
    city.leaderDirectives = {};
    return;
  }

  const descriptorList: CollectiveLeaderDescriptor[] = [];
  const nowTick = context.currentTick;

  sorted.slice(0, MAX_SECONDARY_LEADERS + 1).forEach((evaluation, index) => {
    const role = index === 0 ? 'city-steward' : `magistrate-${index}`;
    const title = index === 0 ? 'Steward' : 'Magistrate';
    const existing = city.leaders.find((leader) => leader.role === role && leader.agentId === evaluation.candidate.id);
    const selectedAtTick = existing ? existing.selectedAtTick : nowTick;
    descriptorList.push({
      agentId: evaluation.candidate.id,
      role,
      title,
      score: evaluation.score,
      support: evaluation.support,
      method: evaluation.method,
      temperament: { ...evaluation.candidate.temperament },
      traitFlags: [...evaluation.candidate.traitFlags],
      selectedAtTick,
      notes: evaluation.notes.join(' | ') || undefined,
    });
  });

  const primary = descriptorList[0] ?? null;
  city.primaryLeaderId = primary ? primary.agentId : null;
  city.leaders = descriptorList;
  city.leaderDirectives = buildLeaderDirectives(descriptorList, 'city');
}

function evaluateLeadershipSet(
  candidates: HouseAssignableAgent[],
  context: LeadershipSelectionContext,
): LeadershipCandidateEvaluation[] {
  if (candidates.length === 0) {
    return [];
  }

  const voterPool = candidates;
  return candidates.map((candidate) => evaluateLeadershipCandidate(candidate, voterPool, context));
}

function evaluateLeadershipCandidate(
  candidate: HouseAssignableAgent,
  voters: HouseAssignableAgent[],
  context: LeadershipSelectionContext,
): LeadershipCandidateEvaluation {
  const temperamentScore = computeTemperamentScore(candidate.temperament);
  const traitBonus = computeTraitBonus(candidate.traitFlags);
  const voteResult = tallyLeadershipVotes(candidate, voters);
  const support = voteResult.ballots > 0 ? voteResult.support / voteResult.ballots : 0;
  const random = context.rng ? context.rng.nextFloat() * 0.05 : 0;
  const score = temperamentScore + traitBonus + support + random;

  const methodScores: Array<{ method: LeadershipCandidateEvaluation['method']; value: number }> = [
    { method: 'temperament', value: temperamentScore },
    { method: 'traits', value: traitBonus },
    { method: 'votes', value: support },
  ];
  let dominant: LeadershipCandidateEvaluation['method'] = 'temperament';
  let dominantValue = Number.NEGATIVE_INFINITY;
  for (const entry of methodScores) {
    if (entry.value > dominantValue) {
      dominantValue = entry.value;
      dominant = entry.method;
    }
  }

  const notes: string[] = [];
  if (temperamentScore > 0.8) {
    notes.push('Temperament aligns with leadership ideals');
  } else if (temperamentScore < 0) {
    notes.push('Temperament introduces risk');
  }
  if (traitBonus > 0) {
    notes.push('Trait advantages present');
  } else if (traitBonus < 0) {
    notes.push('Trait penalties applied');
  }
  if (support > 0.5) {
    notes.push('Strong peer support');
  }

  return {
    candidate,
    score,
    support,
    method: dominant,
    notes,
    temperamentScore,
    traitBonus,
  };
}

function computeTemperamentScore(temperament: TemperamentProfile): number {
  let total = 0;
  for (const [key, weight] of Object.entries(TEMPERAMENT_WEIGHTS) as Array<
    [keyof TemperamentProfile, number]
  >) {
    const value = temperament[key];
    if (!Number.isFinite(value)) {
      continue;
    }
    total += value * weight;
  }
  return total;
}

function computeTraitBonus(traitFlags: string[]): number {
  if (!Array.isArray(traitFlags) || traitFlags.length === 0) {
    return 0;
  }
  let bonus = 0;
  for (const flag of traitFlags) {
    const weight = TRAIT_PRIORITY[flag];
    if (!weight) {
      continue;
    }
    bonus += weight;
  }
  return bonus;
}

function tallyLeadershipVotes(
  candidate: HouseAssignableAgent,
  voters: HouseAssignableAgent[],
): { support: number; ballots: number } {
  let support = 0;
  let ballots = 0;
  for (const voter of voters) {
    ballots += 1;
    const affinity =
      candidate.temperament.loyaltyBias * (0.6 + voter.temperament.loyaltyBias * 0.4) +
      candidate.temperament.trustBias * (0.4 + voter.temperament.trustBias * 0.3) -
      candidate.temperament.fearBias * (0.55 + voter.temperament.fearBias * 0.35) -
      candidate.temperament.resentmentBias * 0.25;
    let traitInfluence = 0;
    for (const flag of voter.traitFlags ?? []) {
      traitInfluence += (TRAIT_PRIORITY[flag] ?? 0) * 0.15;
    }
    const voteStrength = Math.max(0, affinity + traitInfluence);
    support += voteStrength;
  }
  return { support, ballots };
}

function sortLeadershipEvaluations(
  evaluations: LeadershipCandidateEvaluation[],
  rng?: RngStream | null,
): LeadershipCandidateEvaluation[] {
  const sorted = [...evaluations];
  sorted.sort((a, b) => {
    const difference = b.score - a.score;
    if (Math.abs(difference) > 1e-6) {
      return difference;
    }
    if (rng) {
      const random = rng.nextFloat() - 0.5;
      if (Math.abs(random) > 1e-6) {
        return random > 0 ? 1 : -1;
      }
    }
    return a.candidate.id.localeCompare(b.candidate.id);
  });
  return sorted;
}

function buildLeaderDirectives(
  leaders: CollectiveLeaderDescriptor[],
  scope: 'house' | 'city',
): Record<string, number> {
  if (!Array.isArray(leaders) || leaders.length === 0) {
    return {};
  }
  const directives: Record<string, number> = {};
  const baseWeight = scope === 'city' ? 0.12 : 0.1;

  for (const leader of leaders) {
    const influence = baseWeight * (leader === leaders[0] ? 1.2 : 0.6);
    accumulateDirective(directives, 'loyalty', influence * (leader.temperament.loyaltyBias + 0.2));
    accumulateDirective(directives, 'duty', influence * (leader.temperament.trustBias + 0.1));
    if (leader.traitFlags.includes('steadfast')) {
      accumulateDirective(directives, 'home', influence * 1.4);
    }
    if (leader.traitFlags.includes('territorial')) {
      accumulateDirective(directives, 'defense', influence * 1.3);
      accumulateDirective(directives, 'outward', influence * 0.9);
    }
    if (leader.traitFlags.includes('visionary')) {
      accumulateDirective(directives, 'build', influence * 1.5);
    }
    if (leader.traitFlags.includes('resentful')) {
      accumulateDirective(directives, 'outward', influence * 1.2);
    }
    for (const [tag, weight] of Object.entries(DIRECTIVE_TAG_WEIGHTS)) {
      accumulateDirective(directives, tag, influence * weight);
    }
  }

  return directives;
}

function accumulateDirective(target: Record<string, number>, tag: string, value: number): void {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-4) {
    return;
  }
  const existing = target[tag] ?? 0;
  target[tag] = existing + value;
}

export function cloneLeaderDescriptor(
  leader: CollectiveLeaderDescriptor,
): CollectiveLeaderDescriptor {
  return {
    agentId: leader.agentId,
    role: leader.role,
    title: leader.title,
    score: leader.score,
    support: leader.support,
    method: leader.method,
    temperament: { ...leader.temperament },
    traitFlags: [...leader.traitFlags],
    selectedAtTick: leader.selectedAtTick,
    notes: leader.notes,
  };
}

function runHouseScheduler(
  house: HouseState,
  context: { currentTick: number; rng?: RngStream | null },
): void {
  const tickResult = tickBrain(house.brain, {}, {}, {
    rng: context.rng ?? null,
    tick: context.currentTick,
  });
  house.brainDecision = tickResult.decision;
  house.brainNodeDuration = tickResult.nodeDuration || HOUSE_NODE_DURATION;
  const template = HOUSE_DEMAND_TEMPLATES[house.brain.currentNodeId];
  house.activeDemand = template ? { ...template.tagMultipliers } : {};
}

function runCityScheduler(
  city: CityState,
  context: { currentTick: number; rng?: RngStream | null },
): void {
  const previousNodeId = city.brain.currentNodeId;
  const tickResult = tickBrain(city.brain, {}, {}, {
    rng: context.rng ?? null,
    tick: context.currentTick,
  });
  const duration = tickResult.nodeDuration || 72;
  city.brainDecision = tickResult.decision;
  city.brainNodeDuration = duration;

  const nodeChanged = city.brain.currentNodeId !== previousNodeId;
  if (nodeChanged || !city.activeDemand) {
    city.activeDemand = cloneCityDemand(city.brain.currentNodeId);
    city.demandExpiresAt = context.currentTick + duration;
  } else if (context.currentTick > city.demandExpiresAt) {
    city.activeDemand = cloneCityDemand(city.brain.currentNodeId);
    city.demandExpiresAt = context.currentTick + duration;
  }
}

function determineHouseCount(agentCount: number, desired?: number): number {
  if (typeof desired === 'number' && desired > 0) {
    return Math.floor(desired);
  }
  if (agentCount <= 4) {
    return 1;
  }
  return Math.max(1, Math.round(agentCount / 6));
}

function findNearestHouse(agent: HouseAssignableAgent, houses: HouseState[]): HouseState | null {
  let best: HouseState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const house of houses) {
    const dx = agent.homeX - house.x;
    const dy = agent.homeY - house.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = house;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function cloneCityDemand(nodeId: string): Record<string, number> {
  const template = CITY_DEMAND_TEMPLATES[nodeId];
  return template ? { ...template.tagMultipliers } : {};
}

function applyDemandMultipliers(
  target: Record<string, number>,
  multipliers: Record<string, number>,
): void {
  for (const [tag, multiplier] of Object.entries(multipliers)) {
    if (!Number.isFinite(multiplier)) {
      continue;
    }
    const current = target[tag] ?? 1;
    target[tag] = current * multiplier;
  }
}
