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

const CITY_ELIGIBLE_STAGES: LifeStage[] = ['teen', 'adult'];

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

  assignAgentsToHouses(houses, agents);
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
  };
}

export function assignAgentsToHouses(houses: HouseState[], agents: HouseAssignableAgent[]): void {
  if (houses.length === 0) {
    return;
  }

  const houseMap = new Map<string, HouseState>();
  for (const house of houses) {
    house.members = [];
    houseMap.set(house.id, house);
  }

  for (const agent of agents) {
    let assignedHouse = agent.houseId ? houseMap.get(agent.houseId) ?? null : null;
    if (!assignedHouse) {
      assignedHouse = findNearestHouse(agent, houses);
      agent.houseId = assignedHouse?.id ?? null;
    }

    if (assignedHouse) {
      assignedHouse.members.push(agent.id);
    }
  }
}

export function updateCollectiveDemands(
  houses: HouseState[],
  city: CityState | null,
  agents: HouseAssignableAgent[],
  currentTick: number,
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
    runCityScheduler(city, currentTick);
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
      }
    }
  }

  for (const house of houses) {
    runHouseScheduler(house);
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
    }
  }
}

function runHouseScheduler(house: HouseState): void {
  if (house.brain.nodeTimer > 1) {
    house.brain.nodeTimer -= 1;
  } else {
    const tickResult = tickBrain(house.brain, {});
    house.brainDecision = tickResult.decision;
    house.brainNodeDuration = HOUSE_NODE_DURATION;
    house.brain.nodeTimer = HOUSE_NODE_DURATION;
  }

  const template = HOUSE_DEMAND_TEMPLATES[house.brain.currentNodeId];
  house.activeDemand = template ? { ...template.tagMultipliers } : {};
}

function runCityScheduler(city: CityState, currentTick: number): void {
  if (city.brain.nodeTimer > 1) {
    city.brain.nodeTimer -= 1;
  } else {
    const tickResult = tickBrain(city.brain, {});
    const duration = tickResult.nodeDuration || 72;
    city.brainDecision = tickResult.decision;
    city.brainNodeDuration = duration;
    city.brain.nodeTimer = duration;
    city.activeDemand = cloneCityDemand(city.brain.currentNodeId);
    city.demandExpiresAt = currentTick + duration;
    return;
  }

  if (currentTick > city.demandExpiresAt) {
    const duration = city.brain.nodeTimer || 72;
    city.activeDemand = cloneCityDemand(city.brain.currentNodeId);
    city.demandExpiresAt = currentTick + duration;
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
