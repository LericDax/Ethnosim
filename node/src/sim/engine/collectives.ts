import {
  createBrainState,
  tickBrain,
  type BrainDecision,
  type BrainState,
} from './brain.ts';
import type { BrainMultiplierSet } from './brain.ts';
import type { RngStream } from './rng.ts';

const HOUSE_MIND_ID = 'HouseMind_v1';
const HOUSE_NODE_DURATION = 12;

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
}

interface HouseSpawnOptions {
  width: number;
  height: number;
  rng: RngStream;
  agents: HouseAssignableAgent[];
  desiredHouseCount?: number;
}

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

    const brain = createBrainState(HOUSE_MIND_ID);

    houses.push({
      id: `house-${i}`,
      x,
      y,
      radius,
      brain,
      brainNodeDuration: HOUSE_NODE_DURATION,
      brainDecision: null,
      members: [],
      activeDemand: {},
    });
  }

  assignAgentsToHouses(houses, agents);
  return houses;
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

export function updateHouseDemands(houses: HouseState[], agents: HouseAssignableAgent[]): void {
  if (houses.length === 0) {
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
      for (const [tag, multiplier] of Object.entries(template)) {
        const current = demand[tag] ?? 1;
        demand[tag] = current * multiplier;
      }
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
