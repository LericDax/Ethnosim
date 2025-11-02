import {
  createBrainState,
  getCurrentNodeMetadata,
  type BrainMigrationSeed,
} from './brain.ts';
import type { AgentState, LifeStage, SimulationState } from '../sim.worker.ts';
import type { RngStream } from './rng.ts';

export const STAGE_BRAIN_IDS: Record<LifeStage, string> = {
  baby: 'BabyMind_v1',
  child: 'ChildMind_v1',
  teen: 'TeenMind_v1',
  adult: 'AdultMind_v1',
};

export const STAGE_BASE_SPEED: Record<LifeStage, number> = {
  baby: 0,
  child: 0.6,
  teen: 0.9,
  adult: 0.8,
};

export const STAGE_LIMITS: Record<LifeStage, number | null> = {
  baby: 200,
  child: 400,
  teen: 400,
  adult: null,
};

const NEXT_STAGE: Record<LifeStage, LifeStage | null> = {
  baby: 'child',
  child: 'teen',
  teen: 'adult',
  adult: null,
};

export interface AgingHooks {
  onEnterAdulthood?: (agent: AgentState, simulation: SimulationState) => void;
}

export function stepAging(simulation: SimulationState, hooks?: AgingHooks): void {
  const tickStream = simulation.rng.tick;
  for (const agent of simulation.agents) {
    agent.ageTicks += 1;
    const limit = STAGE_LIMITS[agent.lifeStage];
    if (typeof limit === 'number' && limit > 0 && agent.ageTicks >= limit) {
      const nextStage = NEXT_STAGE[agent.lifeStage];
      if (nextStage) {
        const wasAdult = agent.lifeStage === 'adult';
        transitionToStage(agent, nextStage, tickStream);
        if (!wasAdult && agent.lifeStage === 'adult') {
          hooks?.onEnterAdulthood?.(agent, simulation);
        }
      } else {
        agent.ageTicks = limit;
      }
    }
  }
}

export function transitionToStage(
  agent: AgentState,
  stage: LifeStage,
  tickStream: RngStream,
): void {
  const previousStage = agent.lifeStage;
  if (previousStage === stage) {
    return;
  }

  const nextBrainId = STAGE_BRAIN_IDS[stage] ?? agent.brain.brainId;
  const migrationSeed = prepareBrainMigrationSeed(agent, nextBrainId);

  agent.lifeStage = stage;
  agent.ageTicks = 0;

  const brainId = nextBrainId;
  agent.brain = createBrainState(brainId, migrationSeed ?? undefined);
  const metadata = getCurrentNodeMetadata(agent.brain);
  agent.brainNodeDuration = metadata.duration;
  agent.brainDecision = null;

  if (stage in STAGE_BASE_SPEED) {
    agent.speed = STAGE_BASE_SPEED[stage as keyof typeof STAGE_BASE_SPEED];
  }

  const isGestator = agent.reproductiveRoles.includes('gestator');
  if (stage === 'adult') {
    agent.fertility = isGestator ? 0.4 + tickStream.nextFloat() * 0.5 : 0;
  } else if (isGestator) {
    agent.fertility = 0;
  }

  if (stage === 'adult') {
    agent.caregiverId = null;
  }
}

function prepareBrainMigrationSeed(agent: AgentState, nextBrainId: string): BrainMigrationSeed | null {
  const previousBrain = agent.brain;
  if (!previousBrain || previousBrain.brainId === nextBrainId) {
    return null;
  }

  const plasticityEdges: BrainMigrationSeed['plasticityEdges'] = [];
  for (const [sourceId, targetMap] of previousBrain.plasticity.edges.entries()) {
    for (const [targetId, edgeState] of targetMap.entries()) {
      plasticityEdges.push({
        sourceId,
        targetId,
        state: {
          adjustment: edgeState.adjustment,
          usageCount: edgeState.usageCount,
          nextDecayTick: edgeState.nextDecayTick,
        },
      });
    }
  }

  const recentAssociations: BrainMigrationSeed['recentAssociations'] = [];
  for (const association of previousBrain.recentAssociations.values()) {
    recentAssociations.push({
      sourceId: association.sourceId,
      targetId: association.targetId,
      weight: association.weight,
      ttl: association.ttl,
      decay: association.decay,
    });
  }

  const contextEmbedding = [...previousBrain.contextEmbedding];
  const currentNode = getCurrentNodeMetadata(previousBrain);

  return {
    sourceBrainId: previousBrain.brainId,
    targetBrainId: nextBrainId,
    plasticityTick: previousBrain.plasticity.tick,
    plasticityEdges,
    recentAssociations,
    contextEmbedding,
    sourceActiveNodeDuration: currentNode.duration,
  };
}
