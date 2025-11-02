import { describe, expect, it } from 'vitest';
import { transitionToStage } from '../src/sim/engine/aging.ts';
import { createBrainState } from '../src/sim/engine/brain.ts';
import { registerPlasticityOutcome } from '../src/sim/engine/plasticity.ts';

const CONSTANT_STREAM = { nextFloat: () => 0.42 };

function createBabyAgent() {
  const brain = createBrainState('BabyMind_v1');
  registerPlasticityOutcome(brain.plasticity, 'CryForCare', 'Feed', 0.8);
  registerPlasticityOutcome(brain.plasticity, 'ObserveVoices', 'CryForCare', 0.45);

  brain.recentAssociations.set('CryForCare->Feed', {
    sourceId: 'CryForCare',
    targetId: 'Feed',
    weight: 0.9,
    ttl: 4,
    decay: 0.68,
  });

  const embedding = brain.contextEmbedding;
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] = 0;
  }
  embedding[0] = 0.7;
  embedding[1] = 0.35;
  embedding[2] = 0.2;

  return {
    lifeStage: 'baby',
    ageTicks: 0,
    brain,
    brainDecision: null,
    brainNodeDuration: 0,
    reproductiveRoles: [],
    fertility: 0,
    caregiverId: 'caregiver',
    speed: 0,
  };
}

function snapshotPlasticity(brain) {
  const edges = [];
  for (const [sourceId, targetMap] of brain.plasticity.edges.entries()) {
    for (const [targetId, edgeState] of targetMap.entries()) {
      edges.push({
        sourceId,
        targetId,
        adjustment: Number(edgeState.adjustment.toFixed(6)),
        usageCount: edgeState.usageCount,
        nextDecayTick: edgeState.nextDecayTick,
      });
    }
  }
  edges.sort((a, b) => {
    if (a.sourceId === b.sourceId) {
      return a.targetId.localeCompare(b.targetId);
    }
    return a.sourceId.localeCompare(b.sourceId);
  });
  return edges;
}

function snapshotAssociations(brain) {
  const entries = Array.from(brain.recentAssociations.values()).map((assoc) => ({
    sourceId: assoc.sourceId,
    targetId: assoc.targetId,
    weight: Number(assoc.weight.toFixed(6)),
    ttl: assoc.ttl,
    decay: Number(assoc.decay.toFixed(4)),
  }));
  entries.sort((a, b) => {
    if (a.sourceId === b.sourceId) {
      return a.targetId.localeCompare(b.targetId);
    }
    return a.sourceId.localeCompare(b.sourceId);
  });
  return entries;
}

function snapshotBrainMigrationResult(brain) {
  return {
    brainId: brain.brainId,
    plasticityTick: brain.plasticity.tick,
    edges: snapshotPlasticity(brain),
    associations: snapshotAssociations(brain),
    contextEmbedding: brain.contextEmbedding.map((value) => Number(value.toFixed(6))),
  };
}

describe('stage transition migration', () => {
  it('preserves learned plasticity and associations when advancing stages', () => {
    const agent = createBabyAgent();

    transitionToStage(agent, 'child', CONSTANT_STREAM);

    expect(agent.brain.brainId).toBe('ChildMind_v1');

    let totalAdjustment = 0;
    for (const edge of snapshotPlasticity(agent.brain)) {
      totalAdjustment += Math.abs(edge.adjustment);
    }
    expect(totalAdjustment).toBeGreaterThan(0);

    const associations = snapshotAssociations(agent.brain);
    expect(associations.length).toBeGreaterThan(0);
    for (const association of associations) {
      expect(association.ttl).toBeGreaterThan(0);
      expect(association.weight).toBeGreaterThan(0);
    }

    const embeddingMagnitude = agent.brain.contextEmbedding.reduce((sum, value) => sum + value * value, 0);
    expect(embeddingMagnitude).toBeGreaterThan(0);
  });

  it('produces deterministic migrations for identical histories', () => {
    const firstAgent = createBabyAgent();
    const secondAgent = createBabyAgent();

    transitionToStage(firstAgent, 'child', CONSTANT_STREAM);
    transitionToStage(secondAgent, 'child', CONSTANT_STREAM);

    expect(snapshotBrainMigrationResult(firstAgent.brain)).toEqual(
      snapshotBrainMigrationResult(secondAgent.brain),
    );
  });
});
