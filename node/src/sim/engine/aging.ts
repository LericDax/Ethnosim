import { createBrainState, getCurrentNodeMetadata } from './brain.ts';
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

export function stepAging(simulation: SimulationState): void {
  const tickStream = simulation.rng.tick;
  for (const agent of simulation.agents) {
    agent.ageTicks += 1;
    const limit = STAGE_LIMITS[agent.lifeStage];
    if (typeof limit === 'number' && limit > 0 && agent.ageTicks >= limit) {
      const nextStage = NEXT_STAGE[agent.lifeStage];
      if (nextStage) {
        transitionToStage(agent, nextStage, tickStream);
      } else {
        agent.ageTicks = limit;
      }
    }
  }
}

function transitionToStage(agent: AgentState, stage: LifeStage, tickStream: RngStream): void {
  const previousStage = agent.lifeStage;
  if (previousStage === stage) {
    return;
  }

  agent.lifeStage = stage;
  agent.ageTicks = 0;

  const brainId = STAGE_BRAIN_IDS[stage] ?? agent.brain.brainId;
  agent.brain = createBrainState(brainId);
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
