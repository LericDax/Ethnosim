import { createBrainState } from '../core/brains.js';

const BABY_TO_CHILD = 200;
const CHILD_TO_TEEN = 400;
const TEEN_TO_ADULT = 400;

/**
 * Updates age ticks and transitions between life stages.
 * @param {Array} agents
 * @param {import('../core/rng.js').RNG} rng
 */
export function applyAging(agents, rng) {
  for (const agent of agents) {
    agent.age_ticks = (agent.age_ticks ?? 0) + 1;

    if (agent.age_stage === 'baby' && agent.age_ticks > BABY_TO_CHILD) {
      agent.age_stage = 'child';
      agent.age_ticks = 0;
      agent.brain = createBrainState('ChildMind_v1');
    } else if (agent.age_stage === 'child' && agent.age_ticks > CHILD_TO_TEEN) {
      agent.age_stage = 'teen';
      agent.age_ticks = 0;
      agent.brain = createBrainState('TeenMind_v1');
    } else if (agent.age_stage === 'teen' && agent.age_ticks > TEEN_TO_ADULT) {
      agent.age_stage = 'adult';
      agent.age_ticks = 0;
      agent.brain = createBrainState('AdultMind_v1');
      if (agent.sex_body === 'female') {
        agent.fertility = rng.nextRange(0.4, 0.9);
      } else {
        agent.fertility = 0;
      }
    }
  }
}
