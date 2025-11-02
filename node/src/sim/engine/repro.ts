import { createBrainState, getCurrentNodeMetadata, type BrainMultiplierSet } from './brain.ts';
import { STAGE_BASE_SPEED, STAGE_BRAIN_IDS } from './aging.ts';
import type { AgentState, SimulationState, Temperament } from '../sim.worker.ts';
import type { RngStream } from './rng.ts';
import { createFetusTemperament, applyGestationalStress } from './temperament.ts';
import { createTraitProfile } from './traits.ts';
import { sampleChromosomes } from './chromosomes.ts';
import { createInitialMovementState } from './move.ts';
import { createResourceBundle } from './resources.ts';
import {
  createInitialRelationshipState,
  registerPregnancyBond,
  registerBirthBond,
  updateRelationshipMultipliers,
} from './relationships.ts';

const CONCEPTION_RATE_MULTIPLIER = 0.02;
export const GESTATION_TICKS = 200;

export interface ReproductiveGroupMember {
  agentId: string;
  role: string;
}

export interface ReproductiveGroup {
  id: string;
  formedAtTick: number;
  members: ReproductiveGroupMember[];
}

export function matchReproductivePartners(simulation: SimulationState): void {
  const agentsById = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    agentsById.set(agent.id, agent);
  }

  const assignedAgents = new Set<string>();
  const updatedGroups: ReproductiveGroup[] = [];

  for (const group of simulation.reproductiveGroups) {
    const members: ReproductiveGroupMember[] = [];
    for (const member of group.members) {
      const agent = agentsById.get(member.agentId);
      if (!agent || !isMemberCompatible(agent, member.role)) {
        if (agent) {
          clearAgentReproductiveAssignment(agent);
        }
        continue;
      }
      assignAgentToGroup(agent, group.id, member.role);
      members.push({ agentId: agent.id, role: member.role });
      assignedAgents.add(agent.id);
    }

    if (!groupHasRequiredRoles(members)) {
      for (const member of members) {
        const agent = agentsById.get(member.agentId);
        if (agent) {
          clearAgentReproductiveAssignment(agent);
        }
      }
      continue;
    }

    const normalizedGroup: ReproductiveGroup = {
      id: group.id,
      formedAtTick: group.formedAtTick,
      members,
    };
    updatedGroups.push(normalizedGroup);
    updateGroupBondReferences(normalizedGroup, agentsById);
  }

  const availableGestators: AgentState[] = [];
  const availableFertilizers: AgentState[] = [];

  for (const agent of simulation.agents) {
    if (assignedAgents.has(agent.id)) {
      continue;
    }
    if (agent.lifeStage !== 'adult') {
      continue;
    }
    if (agent.reproductiveRoles.includes('gestator') && !agent.pregnancy && agent.fertility > 0) {
      availableGestators.push(agent);
    }
    if (agent.reproductiveRoles.includes('fertilizer')) {
      availableFertilizers.push(agent);
    }
  }

  shuffleInPlace(availableGestators, simulation.rng.tick);
  shuffleInPlace(availableFertilizers, simulation.rng.tick);

  const usedFertilizers = new Set<string>();
  for (const gestator of availableGestators) {
    const partner = availableFertilizers.find(
      (candidate) => candidate.id !== gestator.id && !usedFertilizers.has(candidate.id),
    );
    if (!partner) {
      continue;
    }

    const groupId = `rg-${simulation.nextReproductiveGroupId}`;
    simulation.nextReproductiveGroupId += 1;

    const newGroup: ReproductiveGroup = {
      id: groupId,
      formedAtTick: simulation.tick,
      members: [
        { agentId: gestator.id, role: 'gestator' },
        { agentId: partner.id, role: 'fertilizer' },
      ],
    };

    assignAgentToGroup(gestator, newGroup.id, 'gestator');
    assignAgentToGroup(partner, newGroup.id, 'fertilizer');
    assignedAgents.add(gestator.id);
    assignedAgents.add(partner.id);
    usedFertilizers.add(partner.id);

    updatedGroups.push(newGroup);
    updateGroupBondReferences(newGroup, agentsById);
  }

  simulation.reproductiveGroups = updatedGroups;
}

export function releaseAgentFromReproductiveGroups(
  simulation: SimulationState,
  agentId: string,
): void {
  if (simulation.reproductiveGroups.length === 0) {
    return;
  }

  const agentsById = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    agentsById.set(agent.id, agent);
  }

  let wasMember = false;
  const remainingGroups: ReproductiveGroup[] = [];

  for (const group of simulation.reproductiveGroups) {
    const contains = group.members.some((member) => member.agentId === agentId);
    if (!contains) {
      remainingGroups.push(group);
      continue;
    }

    wasMember = true;
    for (const member of group.members) {
      const agent = agentsById.get(member.agentId);
      if (agent) {
        clearAgentReproductiveAssignment(agent);
      }
    }
  }

  if (!wasMember) {
    return;
  }

  simulation.reproductiveGroups = remainingGroups;
  matchReproductivePartners(simulation);
}

export function handleReproduction(simulation: SimulationState): void {
  const rng = simulation.rng.tick;
  const agentsById = new Map<string, AgentState>();
  for (const agent of simulation.agents) {
    agentsById.set(agent.id, agent);
  }

  const newborns: AgentState[] = [];
  const newPregnancies = new Set<string>();

  const groupsById = new Map<string, ReproductiveGroup>();
  for (const group of simulation.reproductiveGroups) {
    groupsById.set(group.id, group);
  }

  for (const agent of simulation.agents) {
    if (
      agent.lifeStage !== 'adult' ||
      !agent.reproductiveRoles.includes('gestator') ||
      agent.fertility <= 0 ||
      agent.pregnancy
    ) {
      continue;
    }

    const group = agent.reproductiveGroupId ? groupsById.get(agent.reproductiveGroupId) : null;
    if (!group) {
      continue;
    }

    const partner = getFirstPartnerForRole(group, agent.id, 'fertilizer', agentsById);
    if (!partner) {
      continue;
    }

    const roll = rng.nextFloat();
    const chance = agent.fertility * CONCEPTION_RATE_MULTIPLIER;
    if (roll < chance) {
      const fetusTemperament = createFetusTemperament(agent.temperament, partner.temperament, rng);
      agent.pregnancy = {
        timeRemaining: GESTATION_TICKS,
        fetusTemperament,
        coParentId: partner.id,
      };
      registerPregnancyBond(agent, partner, simulation.tick);
      newPregnancies.add(agent.id);
    }
  }

  for (const agent of simulation.agents) {
    if (!agent.pregnancy) {
      continue;
    }

    if (newPregnancies.has(agent.id)) {
      continue;
    }

    progressGestation(agent, simulation, rng);

    if (agent.pregnancy && agent.pregnancy.timeRemaining <= 0) {
      const coParent = agent.pregnancy.coParentId
        ? agentsById.get(agent.pregnancy.coParentId) ?? null
        : null;
      const baby = createNewborn(simulation, agent);
      newborns.push(baby);
      registerBirthBond(simulation, agent, coParent, baby);
      agent.pregnancy = null;
    }
  }

  if (newborns.length > 0) {
    simulation.agents.push(...newborns);
  }
}

function progressGestation(agent: AgentState, simulation: SimulationState, rng: RngStream): void {
  const pregnancy = agent.pregnancy;
  if (!pregnancy) {
    return;
  }

  pregnancy.timeRemaining -= 1;
  if (pregnancy.timeRemaining < 0) {
    pregnancy.timeRemaining = 0;
  }
  const stress = computeGestationalStress(agent, simulation, rng);
  applyGestationalStress(pregnancy.fetusTemperament, stress);

  if (pregnancy.timeRemaining > 0) {
    return;
  }
}

function computeGestationalStress(agent: AgentState, simulation: SimulationState, rng: RngStream): number {
  const dx = agent.x - simulation.world.centerX;
  const dy = agent.y - simulation.world.centerY;
  const distance = Math.hypot(dx, dy);
  const base = distance / 40;
  const noise = rng.nextFloat() * 0.1;
  return Math.min(1, base + noise);
}

function createNewborn(simulation: SimulationState, parent: AgentState): AgentState {
  const pregnancy = parent.pregnancy;
  const fetusTemperament = pregnancy?.fetusTemperament ?? parent.temperament;
  const temperament: Temperament = {
    trustBias: fetusTemperament.trustBias,
    fearBias: fetusTemperament.fearBias,
    loyaltyBias: fetusTemperament.loyaltyBias,
    resentmentBias: fetusTemperament.resentmentBias,
    territorialBias: fetusTemperament.territorialBias,
    zealBias: fetusTemperament.zealBias,
  };

  const id = `agent-${simulation.nextAgentId}`;
  simulation.nextAgentId += 1;

  const chromosomes = sampleChromosomes(simulation.chromosomeRegistry, simulation.rng.tick);
  const genderRoll = simulation.rng.tick.nextFloat();
  const genderIdentity = genderRoll < 0.4 ? 'man' : genderRoll < 0.8 ? 'woman' : 'nonbinary';

  const brain = createBrainState(STAGE_BRAIN_IDS.baby);
  const traitProfile = createTraitProfile(temperament);
  brain.traitFlags = [...traitProfile.traitFlags];
  const brainMetadata = getCurrentNodeMetadata(brain);

  const parents: string[] = [parent.id];
  if (pregnancy?.coParentId && pregnancy.coParentId !== parent.id) {
    parents.push(pregnancy.coParentId);
  }

  const baby: AgentState = {
    id,
    x: parent.x,
    y: parent.y,
    lifeStage: 'baby',
    ageTicks: 0,
    speed: STAGE_BASE_SPEED.baby,
    homeX: parent.homeX,
    homeY: parent.homeY,
    caregiverId: parent.id,
    explorationBias: simulation.rng.tick.nextFloat(),
    brain,
    brainMultipliers: buildBrainMultipliersFromProfile(traitProfile),
    brainNodeDuration: brainMetadata.duration,
    brainDecision: null,
    chromosomes,
    reproductiveRoles: [...chromosomes.roles],
    genderIdentity,
    fertility: 0,
    pregnancy: null,
    bondPartnerId: null,
    reproductiveGroupId: null,
    reproductiveGroupRole: null,
    parents,
    temperament,
    traitFlags: [...traitProfile.traitFlags],
    moods: buildInitialMoodStateFromProfile(traitProfile),
    houseId: parent.houseId,
    carriedResources: createResourceBundle(),
    resourceActivity: null,
    movement: createInitialMovementState(),
    relationships: createInitialRelationshipState(),
  };
  updateRelationshipMultipliers(baby);
  return baby;
}

function buildBrainMultipliersFromProfile(
  profile: ReturnType<typeof createTraitProfile>,
): BrainMultiplierSet {
  const multipliers: BrainMultiplierSet = { demand: {} };
  if (profile.multipliers.mood) {
    multipliers.mood = { ...profile.multipliers.mood };
  }
  if (profile.multipliers.personality) {
    multipliers.personality = { ...profile.multipliers.personality };
  }
  return multipliers;
}

function buildInitialMoodStateFromProfile(
  profile: ReturnType<typeof createTraitProfile>,
): Record<string, number> {
  const moods: Record<string, number> = { ...profile.moodLevels };
  moods.unhoused = 0;
  return moods;
}

function isMemberCompatible(agent: AgentState, role: string): boolean {
  if (agent.lifeStage !== 'adult') {
    return false;
  }
  return agent.reproductiveRoles.includes(role);
}

function groupHasRequiredRoles(members: ReproductiveGroupMember[]): boolean {
  if (members.length < 2) {
    return false;
  }
  let hasGestator = false;
  let hasFertilizer = false;
  for (const member of members) {
    if (member.role === 'gestator') {
      hasGestator = true;
    } else if (member.role === 'fertilizer') {
      hasFertilizer = true;
    }
  }
  return hasGestator && hasFertilizer;
}

function assignAgentToGroup(agent: AgentState, groupId: string, role: string): void {
  agent.reproductiveGroupId = groupId;
  agent.reproductiveGroupRole = role;
}

function clearAgentReproductiveAssignment(agent: AgentState): void {
  agent.reproductiveGroupId = null;
  agent.reproductiveGroupRole = null;
  agent.bondPartnerId = null;
}

function updateGroupBondReferences(
  group: ReproductiveGroup,
  agentsById: Map<string, AgentState>,
): void {
  const gestators: AgentState[] = [];
  const fertilizers: AgentState[] = [];
  for (const member of group.members) {
    const agent = agentsById.get(member.agentId);
    if (!agent) {
      continue;
    }
    if (member.role === 'gestator') {
      gestators.push(agent);
    } else if (member.role === 'fertilizer') {
      fertilizers.push(agent);
    }
  }

  const primaryGestator = gestators[0] ?? null;
  const primaryFertilizer = fertilizers[0] ?? null;

  for (const gestator of gestators) {
    gestator.bondPartnerId = primaryFertilizer ? primaryFertilizer.id : null;
  }
  for (const fertilizer of fertilizers) {
    fertilizer.bondPartnerId = primaryGestator ? primaryGestator.id : null;
  }
}

function getFirstPartnerForRole(
  group: ReproductiveGroup,
  agentId: string,
  desiredRole: string,
  agentsById: Map<string, AgentState>,
): AgentState | null {
  for (const member of group.members) {
    if (member.role !== desiredRole) {
      continue;
    }
    if (member.agentId === agentId) {
      continue;
    }
    const partner = agentsById.get(member.agentId);
    if (partner) {
      return partner;
    }
  }
  return null;
}

function shuffleInPlace<T>(array: T[], rng: RngStream): void {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    const temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }
}
