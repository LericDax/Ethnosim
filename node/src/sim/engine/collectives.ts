import {
  createBrainState,
  tickBrain,
  getNodeMetadata,
  registerDecisionOutcome,
  type BrainDecision,
  type BrainState,
} from './brain.ts';
import type { BrainMultiplierSet } from './brain.ts';
import type { RngStream } from './rng.ts';
import type { ScenarioHousingConfig, ScenarioHousingProfile } from '../../../../shared/types.ts';
import {
  RESOURCE_TYPES,
  createResourceBundle,
  ensureResourceBundle,
  getResourceAmount,
  type ResourceBundle,
  type ResourceType,
} from './resources.ts';
import {
  registerLeadershipSelectionRelationships,
  registerDemandPressure,
} from './relationships.ts';
import type { RelationshipState } from './relationships.ts';
import type { AgentState } from '../sim.worker.ts';

export type { ResourceBundle, ResourceType } from './resources.ts';
export { RESOURCE_TYPES } from './resources.ts';

const HOUSE_MIND_ID = 'HouseMind_v1';
const HOUSE_NODE_DURATION = 12;
const CITY_MIND_ID = 'UrbanMind_v1';
const CITY_RADIUS_FACTOR = 0.35;

export type HousePreferredMode = 'ratio' | 'fixed' | 'none';

export interface HouseCapacityRuleState {
  radiusFactor: number;
  base: number;
  min: number;
  max: number;
  preferredRatio: number;
  preferredMode: HousePreferredMode;
  maxMembersOverride: number | null;
  preferredMembersOverride: number | null;
}

export interface HouseCapacityController {
  defaultArchetypeId: string;
  defaults: HouseCapacityRuleState;
  archetypes: Map<string, HouseCapacityRuleState>;
}

export interface SerializedHouseCapacityRule {
  radiusFactor: number;
  base: number;
  min: number;
  max: number;
  preferredRatio: number;
  preferredMode: HousePreferredMode;
  maxMembersOverride: number | null;
  preferredMembersOverride: number | null;
}

export interface SerializedHouseCapacityController {
  defaultArchetypeId: string;
  defaults: SerializedHouseCapacityRule;
  archetypes: Record<string, SerializedHouseCapacityRule>;
}

export type HouseCapacityPatch = ScenarioHousingProfile;

export const DEFAULT_HOUSE_ARCHETYPE_ID = 'default';

const DEFAULT_CAPACITY_RULE: HouseCapacityRuleState = {
  radiusFactor: 0.6,
  base: 2,
  min: 3,
  max: 16,
  preferredRatio: 0.85,
  preferredMode: 'ratio',
  maxMembersOverride: null,
  preferredMembersOverride: null,
};

const MIN_RADIUS_FACTOR = 0.05;
const MAX_RADIUS_FACTOR = 8;

function cloneHouseCapacityRule(rule: HouseCapacityRuleState): HouseCapacityRuleState {
  return { ...rule };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function sanitizeArchetypeId(id?: string | null): string {
  if (!id) {
    return '';
  }
  return String(id).trim();
}

function normalizeHouseCapacityRule(rule: HouseCapacityRuleState): HouseCapacityRuleState {
  const radiusFactor = clampNumber(rule.radiusFactor, MIN_RADIUS_FACTOR, MAX_RADIUS_FACTOR);
  const base = Number.isFinite(rule.base) ? rule.base : DEFAULT_CAPACITY_RULE.base;
  const min = Math.max(1, Math.floor(Number.isFinite(rule.min) ? rule.min : DEFAULT_CAPACITY_RULE.min));
  const rawMax = Math.floor(Number.isFinite(rule.max) ? rule.max : DEFAULT_CAPACITY_RULE.max);
  const max = rawMax >= min ? rawMax : min;
  const preferredRatio = clampNumber(rule.preferredRatio, 0, 1);
  let preferredMode: HousePreferredMode = rule.preferredMode ?? 'ratio';

  let maxOverride: number | null = null;
  if (rule.maxMembersOverride !== null && Number.isFinite(rule.maxMembersOverride)) {
    const sanitized = Math.floor(rule.maxMembersOverride);
    maxOverride = Math.max(min, Math.min(max, sanitized));
  }

  let preferredOverride: number | null = null;
  if (preferredMode === 'fixed') {
    if (rule.preferredMembersOverride !== null && Number.isFinite(rule.preferredMembersOverride)) {
      const sanitized = Math.floor(rule.preferredMembersOverride);
      const ceiling = maxOverride ?? max;
      preferredOverride = Math.max(1, Math.min(ceiling, sanitized));
    } else {
      // No explicit value, fall back to ratio semantics.
      preferredMode = preferredRatio > 0 ? 'ratio' : 'none';
    }
  }

  if (preferredMode === 'ratio' && preferredRatio <= 0) {
    preferredMode = 'none';
  }

  if (preferredMode === 'none') {
    preferredOverride = null;
  }

  return {
    radiusFactor,
    base,
    min,
    max,
    preferredRatio,
    preferredMode,
    maxMembersOverride: maxOverride,
    preferredMembersOverride: preferredMode === 'fixed' ? preferredOverride : null,
  };
}

function applyHouseCapacityPatchInternal(
  base: HouseCapacityRuleState,
  patch?: HouseCapacityPatch | null,
): HouseCapacityRuleState {
  if (!patch) {
    return cloneHouseCapacityRule(base);
  }

  const next: HouseCapacityRuleState = cloneHouseCapacityRule(base);

  if (typeof patch.radius_density === 'number' && Number.isFinite(patch.radius_density) && patch.radius_density > 0) {
    next.radiusFactor = patch.radius_density;
  }
  if (typeof patch.base === 'number' && Number.isFinite(patch.base)) {
    next.base = patch.base;
  }
  if (typeof patch.min_members === 'number' && Number.isFinite(patch.min_members)) {
    next.min = Math.max(1, Math.floor(patch.min_members));
  }
  if (typeof patch.max_members_cap === 'number' && Number.isFinite(patch.max_members_cap)) {
    next.max = Math.max(next.min, Math.floor(patch.max_members_cap));
  }
  if (typeof patch.preferred_ratio === 'number' && Number.isFinite(patch.preferred_ratio)) {
    const ratio = clampNumber(patch.preferred_ratio, 0, 1);
    next.preferredRatio = ratio;
    if (patch.preferred_members === undefined) {
      next.preferredMode = ratio > 0 ? 'ratio' : 'none';
    }
  }

  if (patch.max_members === null) {
    next.maxMembersOverride = null;
  } else if (typeof patch.max_members === 'number' && Number.isFinite(patch.max_members)) {
    next.maxMembersOverride = Math.floor(patch.max_members);
  }

  if (patch.preferred_members === null) {
    next.preferredMode = 'none';
    next.preferredMembersOverride = null;
  } else if (patch.preferred_members === 'ratio') {
    next.preferredMode = 'ratio';
    next.preferredMembersOverride = null;
  } else if (typeof patch.preferred_members === 'number' && Number.isFinite(patch.preferred_members)) {
    next.preferredMode = 'fixed';
    next.preferredMembersOverride = Math.floor(patch.preferred_members);
  }

  return normalizeHouseCapacityRule(next);
}

function computeCapacityFromRule(
  rule: HouseCapacityRuleState,
  radius: number,
): { maxMembers: number; preferredMembers: number | null } {
  const radiusContribution = Math.round(Math.max(0, radius) * rule.radiusFactor + rule.base);
  const capBase = Math.max(rule.min, Math.min(rule.max, radiusContribution));
  const maxMembers = rule.maxMembersOverride !== null ? rule.maxMembersOverride : capBase;

  let preferredMembers: number | null = null;
  switch (rule.preferredMode) {
    case 'fixed': {
      const ceiling = Math.max(1, rule.maxMembersOverride ?? maxMembers);
      const override = rule.preferredMembersOverride ?? ceiling;
      preferredMembers = Math.max(1, Math.min(ceiling, override));
      break;
    }
    case 'ratio': {
      const ratio = clampNumber(rule.preferredRatio, 0, 1);
      if (ratio > 0) {
        preferredMembers = Math.max(1, Math.min(maxMembers, Math.round(maxMembers * ratio)));
      } else {
        preferredMembers = null;
      }
      break;
    }
    case 'none':
    default:
      preferredMembers = null;
      break;
  }

  return { maxMembers, preferredMembers };
}

export function applyHouseCapacityPatch(
  base: HouseCapacityRuleState,
  patch?: HouseCapacityPatch | null,
): HouseCapacityRuleState {
  return applyHouseCapacityPatchInternal(base, patch);
}

export function createHouseCapacityController(
  config?: ScenarioHousingConfig | null,
): HouseCapacityController {
  const controller: HouseCapacityController = {
    defaultArchetypeId: DEFAULT_HOUSE_ARCHETYPE_ID,
    defaults: normalizeHouseCapacityRule(cloneHouseCapacityRule(DEFAULT_CAPACITY_RULE)),
    archetypes: new Map(),
  };

  if (config?.default) {
    controller.defaults = applyHouseCapacityPatchInternal(controller.defaults, config.default);
  }

  const defaultArchetype = sanitizeArchetypeId(config?.default_archetype);
  if (defaultArchetype) {
    controller.defaultArchetypeId = defaultArchetype;
  }

  if (config?.archetypes) {
    for (const [key, value] of Object.entries(config.archetypes)) {
      const archetypeId = sanitizeArchetypeId(key) || DEFAULT_HOUSE_ARCHETYPE_ID;
      const baseRule = archetypeId === controller.defaultArchetypeId ? controller.defaults : controller.defaults;
      controller.archetypes.set(archetypeId, applyHouseCapacityPatchInternal(baseRule, value));
    }
  }

  return controller;
}

export function cloneHouseCapacityController(
  controller: HouseCapacityController,
): HouseCapacityController {
  const clone: HouseCapacityController = {
    defaultArchetypeId: controller.defaultArchetypeId,
    defaults: cloneHouseCapacityRule(controller.defaults),
    archetypes: new Map(),
  };
  for (const [key, value] of controller.archetypes.entries()) {
    clone.archetypes.set(key, cloneHouseCapacityRule(value));
  }
  return clone;
}

export function serializeHouseCapacityController(
  controller: HouseCapacityController,
): SerializedHouseCapacityController {
  const archetypes: Record<string, SerializedHouseCapacityRule> = {};
  for (const [key, value] of controller.archetypes.entries()) {
    archetypes[key] = { ...value };
  }
  return {
    defaultArchetypeId: controller.defaultArchetypeId,
    defaults: { ...controller.defaults },
    archetypes,
  };
}

export function restoreHouseCapacityController(
  serialized?: SerializedHouseCapacityController | null,
  fallbackConfig?: ScenarioHousingConfig | null,
): HouseCapacityController {
  if (serialized) {
    const controller: HouseCapacityController = {
      defaultArchetypeId: sanitizeArchetypeId(serialized.defaultArchetypeId) || DEFAULT_HOUSE_ARCHETYPE_ID,
      defaults: normalizeHouseCapacityRule(serialized.defaults),
      archetypes: new Map(),
    };
    for (const [key, value] of Object.entries(serialized.archetypes ?? {})) {
      const archetypeId = sanitizeArchetypeId(key) || DEFAULT_HOUSE_ARCHETYPE_ID;
      controller.archetypes.set(archetypeId, normalizeHouseCapacityRule(value));
    }
    return controller;
  }
  return createHouseCapacityController(fallbackConfig ?? null);
}

export function resolveHouseCapacity(
  controller: HouseCapacityController,
  radius: number,
  options: { archetypeId?: string | null; override?: HouseCapacityPatch | null } = {},
): { maxMembers: number; preferredMembers: number | null } {
  const archetypeId = sanitizeArchetypeId(options.archetypeId) || controller.defaultArchetypeId;
  const baseRule = controller.archetypes.get(archetypeId) ?? controller.defaults;
  const effectiveRule = options.override
    ? applyHouseCapacityPatchInternal(baseRule, options.override)
    : baseRule;
  return computeCapacityFromRule(effectiveRule, radius);
}

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
  resourceBias?: Partial<Record<ResourceType, number>>;
}

const HOUSE_DEMAND_TEMPLATES: Record<string, HouseDemandTemplate> = {
  FortifyHome: {
    nodeId: 'FortifyHome',
    tagMultipliers: {
      home: 1.3,
      defense: 1.2,
      build: 1.1,
    },
    resourceBias: { wood: 1.2, ore: 0.3 },
  },
  ProtectYoung: {
    nodeId: 'ProtectYoung',
    tagMultipliers: {
      care: 1.4,
      defense: 1.15,
      safety: 1.35,
    },
    resourceBias: { forage: 1.1, wood: 0.4 },
  },
  NurtureHeir: {
    nodeId: 'NurtureHeir',
    tagMultipliers: {
      care: 1.25,
      future: 1.3,
      lineage: 1.2,
    },
    resourceBias: { forage: 1.0, wood: 0.2 },
  },
  EnsureLineage: {
    nodeId: 'EnsureLineage',
    tagMultipliers: {
      lineage: 1.35,
      strategy: 1.15,
      legacy: 1.25,
    },
    resourceBias: { wood: 0.6, ore: 0.9 },
  },
  AvengeSlight: {
    nodeId: 'AvengeSlight',
    tagMultipliers: {
      retaliation: 1.45,
      honor: 1.25,
      outward: 1.2,
    },
    resourceBias: { ore: 1.0, wood: 0.3 },
  },
  AccumulateStock: {
    nodeId: 'AccumulateStock',
    tagMultipliers: {
      resource: 1.4,
      stockpile: 1.3,
      home: 1.1,
    },
    resourceBias: { wood: 0.9, forage: 1.0, ore: 0.4 },
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
  relationships: RelationshipState;
}

export interface HouseState {
  id: string;
  x: number;
  y: number;
  radius: number;
  maxMembers: number;
  preferredMembers: number | null;
  capacityPressure: number;
  archetypeId: string | null;
  brain: BrainState;
  brainNodeDuration: number;
  brainDecision: BrainDecision | null;
  members: string[];
  activeDemand: Record<string, number>;
  stockpiles: ResourceBundle;
  resourceNeeds: ResourceBundle;
  construction: HouseConstructionState;
  primaryLeaderId: string | null;
  leaders: CollectiveLeaderDescriptor[];
  leaderDirectives: Record<string, number>;
}

export function ensureHouseCapacity(
  controller: HouseCapacityController,
  house: HouseState,
  options: { override?: HouseCapacityPatch | null; archetypeId?: string | null } = {},
): { maxMembers: number; preferredMembers: number | null } {
  const archetypeId = sanitizeArchetypeId(options.archetypeId ?? house.archetypeId) ||
    controller.defaultArchetypeId;
  house.archetypeId = archetypeId;
  const resolved = resolveHouseCapacity(controller, house.radius, {
    archetypeId,
    override: options.override ?? null,
  });
  house.maxMembers = resolved.maxMembers;
  house.preferredMembers = resolved.preferredMembers;
  const preferredTarget = house.preferredMembers ?? house.maxMembers;
  house.capacityPressure = Math.max(0, house.members.length - preferredTarget);
  return resolved;
}

export function setHouseCapacityDefaults(
  controller: HouseCapacityController,
  patch?: HouseCapacityPatch | null,
): void {
  controller.defaults = applyHouseCapacityPatchInternal(controller.defaults, patch);
}

export function setHouseCapacityForArchetype(
  controller: HouseCapacityController,
  archetypeId: string,
  patch?: HouseCapacityPatch | null,
): void {
  const id = sanitizeArchetypeId(archetypeId) || controller.defaultArchetypeId;
  if (!patch) {
    controller.archetypes.delete(id);
    return;
  }
  const baseRule = controller.archetypes.get(id) ?? controller.defaults;
  controller.archetypes.set(id, applyHouseCapacityPatchInternal(baseRule, patch));
}

interface CityDemandTemplate {
  nodeId: string;
  tagMultipliers: Record<string, number>;
  resourceBias?: Partial<Record<ResourceType, number>>;
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
    resourceBias: { wood: 0.8, forage: 0.6, ore: 1.0 },
  },
  MaintainOrder: {
    nodeId: 'MaintainOrder',
    tagMultipliers: {
      loyalty: 1.25,
      authority: 1.2,
      control: 1.2,
      discipline: 1.15,
    },
    resourceBias: { forage: 0.5, wood: 0.4 },
  },
  ProjectDoctrine: {
    nodeId: 'ProjectDoctrine',
    tagMultipliers: {
      ritual: 1.35,
      ideology: 1.25,
      loyalty: 1.2,
    },
    resourceBias: { forage: 0.9, wood: 0.3 },
  },
  AbsorbYouth: {
    nodeId: 'AbsorbYouth',
    tagMultipliers: {
      loyalty: 1.25,
      recruit: 1.3,
      youth: 1.2,
      social: 1.1,
    },
    resourceBias: { forage: 1.1, wood: 0.3 },
  },
  SanctifyBirth: {
    nodeId: 'SanctifyBirth',
    tagMultipliers: {
      ritual: 1.4,
      birth: 1.2,
      loyalty: 1.3,
      doctrine: 1.15,
    },
    resourceBias: { forage: 1.2, wood: 0.5 },
  },
  SuppressRivals: {
    nodeId: 'SuppressRivals',
    tagMultipliers: {
      loyalty: 1.2,
      authority: 1.2,
      conflict: 1.15,
    },
    resourceBias: { ore: 1.2, wood: 0.6 },
  },
};

const RESOURCE_DEMAND_TAGS: Record<ResourceType, string> = {
  wood: 'wood',
  forage: 'forage',
  ore: 'ore',
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
  resourceNeeds: ResourceBundle;
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
  housing: HouseCapacityController;
  defaultArchetypeId?: string | null;
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

export interface HouseAssignmentResult {
  overflowAgents: HouseAssignableAgent[];
  fullHouseIds: string[];
  allHousesFull: boolean;
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
  const { width, height, rng, agents, desiredHouseCount, housing, defaultArchetypeId } = options;
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
    houses.push(
      createHouseState(`house-${i}`, x, y, radius, {
        housing,
        archetypeId: defaultArchetypeId ?? housing.defaultArchetypeId,
      }),
    );
  }

  return houses;
}

export function createHouseState(
  id: string,
  x: number,
  y: number,
  radius: number,
  options: { housing: HouseCapacityController; archetypeId?: string | null; override?: HouseCapacityPatch | null },
): HouseState {
  const brain = createBrainState(HOUSE_MIND_ID);
  const archetypeId = sanitizeArchetypeId(options.archetypeId) || options.housing.defaultArchetypeId;
  const capacity = resolveHouseCapacity(options.housing, radius, {
    archetypeId,
    override: options.override ?? null,
  });

  return {
    id,
    x,
    y,
    radius,
    maxMembers: capacity.maxMembers,
    preferredMembers: capacity.preferredMembers,
    capacityPressure: 0,
    archetypeId,
    brain,
    brainNodeDuration: HOUSE_NODE_DURATION,
    brainDecision: null,
    members: [],
    activeDemand: {},
    stockpiles: createResourceBundle(),
    resourceNeeds: createResourceBundle(),
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
    stockpiles: createResourceBundle(),
    resourceNeeds: createResourceBundle(),
    primaryLeaderId: null,
    leaders: [],
    leaderDirectives: {},
  };
}

export function assignAgentsToHouses(
  houses: HouseState[],
  agents: HouseAssignableAgent[],
  options: HouseAssignmentOptions = {},
): HouseAssignmentResult {
  if (houses.length === 0) {
    for (const agent of agents) {
      agent.houseId = null;
    }
    return { overflowAgents: [...agents], fullHouseIds: [], allHousesFull: true };
  }

  const houseMap = new Map<string, HouseState>();
  const remainingSlots = new Map<string, number>();
  for (const house of houses) {
    house.members = [];
    house.capacityPressure = Math.max(0, house.capacityPressure);
    houseMap.set(house.id, house);
    remainingSlots.set(house.id, Math.max(0, Math.floor(house.maxMembers)));
  }

  const agentMap = new Map<string, HouseAssignableAgent>();
  const deferred: HouseAssignableAgent[] = [];
  const overflowAgents: HouseAssignableAgent[] = [];

  for (const agent of agents) {
    agentMap.set(agent.id, agent);
    const assignedHouse = agent.houseId ? houseMap.get(agent.houseId) ?? null : null;
    if (assignedHouse) {
      const slots = remainingSlots.get(assignedHouse.id) ?? 0;
      if (slots > 0) {
        assignedHouse.members.push(agent.id);
        remainingSlots.set(assignedHouse.id, slots - 1);
        continue;
      }
    }
    deferred.push(agent);
  }

  for (const agent of deferred) {
    const target = findNearestHouseWithCapacity(agent, houses, remainingSlots);
    if (target) {
      const slots = remainingSlots.get(target.id) ?? 0;
      target.members.push(agent.id);
      remainingSlots.set(target.id, Math.max(0, slots - 1));
      agent.houseId = target.id;
    } else {
      agent.houseId = null;
      overflowAgents.push(agent);
    }
  }

  const fullHouseIds: string[] = [];
  let allHousesFull = true;
  for (const house of houses) {
    const slots = remainingSlots.get(house.id) ?? 0;
    if (slots > 0) {
      allHousesFull = false;
    } else {
      fullHouseIds.push(house.id);
    }
    const preferredTarget = house.preferredMembers ?? house.maxMembers;
    house.capacityPressure = Math.max(0, house.members.length - preferredTarget);
  }

  const context: LeadershipSelectionContext = {
    currentTick: options.currentTick ?? 0,
    rng: options.rng ?? null,
  };

  for (const house of houses) {
    updateHouseLeadership(house, agentMap, context);
  }

  return { overflowAgents, fullHouseIds, allHousesFull };
}

export function updateCollectiveDemands(
  houses: HouseState[],
  city: CityState | null,
  agents: HouseAssignableAgent[],
  currentTick: number,
  options: { rng?: RngStream | null; pendingAssignmentCount?: number } = {},
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
  const agentMapFull = agentMap as unknown as Map<string, AgentState>;
  const cityPressure = new Map<string, number>();
  const cityEligibleIds = new Set<string>();
  const cityEligibleAgents: AgentState[] = [];
  const processedCityAgents = new Set<string>();
  let primaryCityLeader: AgentState | null = null;

  if (city) {
    electCityLeadership(city, agents, {
      currentTick,
      rng: options.rng ?? null,
    });
    runCityScheduler(city, { currentTick, rng: options.rng ?? null });
    applyCityResourceDemand(city);
    primaryCityLeader = resolveLeaderAgent(city.leaders, agentMapFull, city.primaryLeaderId);
    const cityDemandIntensity =
      sumDemandWeights(city.activeDemand) + sumDemandWeights(city.leaderDirectives);
    const radiusSq = city.radius * city.radius;
    const demandActive =
      Boolean(city.activeDemand && Object.keys(city.activeDemand).length > 0) &&
      currentTick <= city.demandExpiresAt;
    for (const agent of agents) {
      if (!CITY_ELIGIBLE_STAGES.includes(agent.lifeStage)) {
        continue;
      }
      const dx = agent.x - city.x;
      const dy = agent.y - city.y;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      if (!cityEligibleIds.has(agent.id)) {
        cityEligibleIds.add(agent.id);
        cityEligibleAgents.push(agent as AgentState);
      }
      if (!demandActive) {
        continue;
      }
      const demand = agent.brainMultipliers.demand ?? (agent.brainMultipliers.demand = {});
      applyDemandMultipliers(demand, city.activeDemand);
      applyDemandMultipliers(demand, city.leaderDirectives);
      if (cityDemandIntensity > 0) {
        cityPressure.set(agent.id, cityDemandIntensity);
      }
    }
  }

  const pendingAssignments = Math.max(0, options.pendingAssignmentCount ?? 0);

  for (const house of houses) {
    runHouseScheduler(house, { currentTick, rng: options.rng ?? null });
    applyHouseResourceDemand(house, pendingAssignments);
    if (house.members.length === 0) {
      continue;
    }
    const template = house.activeDemand;
    if (!template || Object.keys(template).length === 0) {
      continue;
    }

    const houseDemandIntensity =
      sumDemandWeights(template) + sumDemandWeights(house.leaderDirectives);
    const houseLeader = resolveLeaderAgent(house.leaders, agentMapFull, house.primaryLeaderId);
    const memberAgents: AgentState[] = [];

    for (const memberId of house.members) {
      const agent = agentMap.get(memberId);
      if (!agent) {
        continue;
      }
      const memberAgent = agent as AgentState;
      const demand = memberAgent.brainMultipliers.demand ?? (memberAgent.brainMultipliers.demand = {});
      applyDemandMultipliers(demand, template);
      applyDemandMultipliers(demand, house.leaderDirectives);
      memberAgents.push(memberAgent);

      const cityIntensity = cityPressure.get(memberAgent.id) ?? 0;
      const conflict = houseDemandIntensity > 0.2 && cityIntensity > 0.2;
      if (houseDemandIntensity > 0) {
        registerDemandPressure(
          memberAgent,
          houseLeader,
          houseDemandIntensity,
          'house',
          conflict,
          currentTick,
        );
      }
      if (cityIntensity > 0) {
        registerDemandPressure(
          memberAgent,
          primaryCityLeader,
          cityIntensity,
          'city',
          conflict,
          currentTick,
        );
        processedCityAgents.add(memberAgent.id);
      }
    }

    if (memberAgents.length > 0) {
      registerLeadershipSelectionRelationships(
        agentMapFull,
        house.leaders,
        memberAgents,
        'house',
        currentTick,
      );
    }
  }

  if (cityEligibleAgents.length > 0) {
    registerLeadershipSelectionRelationships(
      agentMapFull,
      city?.leaders ?? [],
      cityEligibleAgents,
      'city',
      currentTick,
    );
  }

  for (const agent of cityEligibleAgents) {
    if (processedCityAgents.has(agent.id)) {
      continue;
    }
    const intensity = cityPressure.get(agent.id) ?? 0;
    if (intensity <= 0) {
      continue;
    }
    registerDemandPressure(agent, primaryCityLeader, intensity, 'city', false, currentTick);
    processedCityAgents.add(agent.id);
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

function sumDemandWeights(template?: Record<string, number> | null): number {
  if (!template) {
    return 0;
  }
  let total = 0;
  for (const value of Object.values(template)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      total += numeric;
    }
  }
  return total;
}

function resolveLeaderAgent(
  leaders: CollectiveLeaderDescriptor[] | undefined,
  agentMap: Map<string, AgentState>,
  preferredId: string | null | undefined,
): AgentState | null {
  if (preferredId) {
    const preferred = agentMap.get(preferredId);
    if (preferred) {
      return preferred;
    }
  }
  if (!leaders) {
    return null;
  }
  for (const leader of leaders) {
    const agent = agentMap.get(leader.agentId);
    if (agent) {
      return agent;
    }
  }
  return null;
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

function findNearestHouseWithCapacity(
  agent: HouseAssignableAgent,
  houses: HouseState[],
  remainingSlots: Map<string, number>,
): HouseState | null {
  let best: HouseState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const house of houses) {
    const slots = remainingSlots.get(house.id) ?? 0;
    if (slots <= 0) {
      continue;
    }
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


function getResourceDemandTag(type: ResourceType): string {
  return RESOURCE_DEMAND_TAGS[type] ?? 'resource';
}

function applyHouseResourceDemand(house: HouseState, pendingAssignments: number): void {
  house.stockpiles = ensureResourceBundle(house.stockpiles);
  const previousNeeds = ensureResourceBundle(house.resourceNeeds);
  const previousTotalNeed = computeTotalNeed(previousNeeds);
  const needs = computeHouseResourceNeeds(house, pendingAssignments);
  const nextTotalNeed = computeTotalNeed(needs);
  house.resourceNeeds = needs;

  if (Math.abs(nextTotalNeed - previousTotalNeed) > 1e-3) {
    const decision = house.brainDecision ?? house.brain.lastDecision;
    if (decision) {
      const magnitude = Math.min(1, Math.abs(nextTotalNeed - previousTotalNeed));
      registerDecisionOutcome(house.brain, {
        category: 'directive',
        magnitude,
        sign: nextTotalNeed < previousTotalNeed ? 1 : -1,
        fromNodeId: decision.fromNodeId,
        toNodeId: decision.chosenNodeId,
        tags: ['house', `house:${house.brain.currentNodeId}`],
      });
    }
  }

  const totalNeed = nextTotalNeed;
  for (const type of RESOURCE_TYPES) {
    const tag = getResourceDemandTag(type);
    const intensity = needs[type] ?? 0;
    if (intensity > 0.05) {
      house.activeDemand[tag] = 1 + intensity * 1.35;
    } else {
      delete house.activeDemand[tag];
    }
  }
  if (totalNeed > 0.12) {
    house.activeDemand.resource = 1 + totalNeed * 0.35;
  } else {
    delete house.activeDemand.resource;
  }
}

function computeHouseResourceNeeds(house: HouseState, pendingAssignments: number): ResourceBundle {
  const template = HOUSE_DEMAND_TEMPLATES[house.brain.currentNodeId] ?? null;
  const bias = template?.resourceBias ?? {};
  const stock = ensureResourceBundle(house.stockpiles);
  const members = Math.max(1, house.members.length);
  const pressure = Math.max(0, house.capacityPressure);
  const constructionProgress = house.construction?.active
    ? Math.max(0, house.construction.required - house.construction.progress) / Math.max(1, house.construction.required)
    : 0;

  const needs = createResourceBundle();
  const woodTarget = 6 + members * 3 + constructionProgress * 14 + pressure * 2 + pendingAssignments * 1.5 + (bias.wood ?? 0) * 4;
  const forageTarget = 4 + members * 2.3 + (bias.forage ?? 0) * 3;
  const oreTarget = 1 + members * 0.5 + constructionProgress * 1.5 + (bias.ore ?? 0) * 2;

  needs.wood = Math.max(0, (woodTarget - getResourceAmount(stock, 'wood')) / Math.max(1, woodTarget));
  needs.forage = Math.max(0, (forageTarget - getResourceAmount(stock, 'forage')) / Math.max(1, forageTarget));
  needs.ore = Math.max(0, (oreTarget - getResourceAmount(stock, 'ore')) / Math.max(1, oreTarget));

  return needs;
}

function applyCityResourceDemand(city: CityState): void {
  city.stockpiles = ensureResourceBundle(city.stockpiles);
  const previousNeeds = ensureResourceBundle(city.resourceNeeds);
  const previousTotalNeed = computeTotalNeed(previousNeeds);
  const needs = computeCityResourceNeeds(city);
  const nextTotalNeed = computeTotalNeed(needs);
  city.resourceNeeds = needs;

  if (Math.abs(nextTotalNeed - previousTotalNeed) > 1e-3) {
    const decision = city.brainDecision ?? city.brain.lastDecision;
    if (decision) {
      const magnitude = Math.min(1, Math.abs(nextTotalNeed - previousTotalNeed));
      registerDecisionOutcome(city.brain, {
        category: 'directive',
        magnitude,
        sign: nextTotalNeed < previousTotalNeed ? 1 : -1,
        fromNodeId: decision.fromNodeId,
        toNodeId: decision.chosenNodeId,
        tags: ['city', `city:${city.brain.currentNodeId}`],
      });
    }
  }

  const totalNeed = nextTotalNeed;
  for (const type of RESOURCE_TYPES) {
    const tag = getResourceDemandTag(type);
    const intensity = needs[type] ?? 0;
    if (intensity > 0.05) {
      city.activeDemand[tag] = 1 + intensity * 1.25;
    } else {
      delete city.activeDemand[tag];
    }
  }
  if (totalNeed > 0.15) {
    city.activeDemand.resource = 1 + totalNeed * 0.3;
  } else {
    delete city.activeDemand.resource;
  }
}

function computeCityResourceNeeds(city: CityState): ResourceBundle {
  const template = CITY_DEMAND_TEMPLATES[city.brain.currentNodeId] ?? null;
  const bias = template?.resourceBias ?? {};
  const stock = ensureResourceBundle(city.stockpiles);
  const radiusFactor = Math.max(1, city.radius);
  const leaderCount = Array.isArray(city.leaders) ? city.leaders.length : 0;

  const needs = createResourceBundle();
  const woodTarget = 18 + radiusFactor * 0.8 + leaderCount * 1.5 + (bias?.wood ?? 0) * 6;
  const forageTarget = 20 + radiusFactor * 1.2 + leaderCount * 2 + (bias?.forage ?? 0) * 7;
  const oreTarget = 10 + radiusFactor * 0.5 + leaderCount * 1.2 + (bias?.ore ?? 0) * 5;

  needs.wood = Math.max(0, (woodTarget - getResourceAmount(stock, 'wood')) / Math.max(1, woodTarget));
  needs.forage = Math.max(0, (forageTarget - getResourceAmount(stock, 'forage')) / Math.max(1, forageTarget));
  needs.ore = Math.max(0, (oreTarget - getResourceAmount(stock, 'ore')) / Math.max(1, oreTarget));

  return needs;
}

function computeTotalNeed(needs: ResourceBundle | null | undefined): number {
  if (!needs) {
    return 0;
  }
  let total = 0;
  for (const type of RESOURCE_TYPES) {
    const value = Number(needs[type]);
    if (Number.isFinite(value) && value > 0) {
      total += value;
    }
  }
  return total;
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
