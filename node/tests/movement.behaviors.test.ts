import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/sim/engine/rng.ts';
import {
  createInitialMovementState,
  moveAgent,
  type MovementContext,
} from '../src/sim/engine/move.ts';
import { createWorld, isForestTile } from '../src/sim/engine/world.ts';
import { createBrainState } from '../src/sim/engine/brain.ts';
import type { MovableAgent } from '../src/sim/engine/move.ts';
import type { HouseState } from '../src/sim/engine/collectives.ts';

function createTestAgent(overrides: Partial<MovableAgent> = {}): MovableAgent {
  const brain = createBrainState('AdultMind_v1');
  const movement = createInitialMovementState();
  return {
    id: 'agent-test',
    x: 32,
    y: 32,
    lifeStage: 'adult',
    speed: 1,
    homeX: 32,
    homeY: 32,
    caregiverId: null,
    explorationBias: 0.5,
    brain,
    brainDecision: null,
    houseId: null,
    traitFlags: [],
    movement,
    ...overrides,
  };
}

function createMovementContext(agent: MovableAgent, house?: HouseState | null): MovementContext {
  const rng = createSeededRng('context-seed');
  const world = createWorld(64, 64, rng.stream('world'));
  const agentsById = new Map<string, MovableAgent>();
  agentsById.set(agent.id, agent);
  const housesById = new Map<string, HouseState>();
  if (house) {
    housesById.set(house.id, house);
  }
  return {
    world,
    agentsById,
    housesById,
    city: null,
    tick: 0,
  };
}

describe('movement behaviors', () => {
  it('wander behavior produces varied waypoints over time', () => {
    const agent = createTestAgent({ x: 52, y: 10, homeX: 52, homeY: 10 });
    agent.brain.currentNodeId = 'Wander';
    agent.brain.nodeTimer = 0;

    const rng = createSeededRng('wander-behavior');
    const context = createMovementContext(agent);
    const moveStream = rng.stream('move');

    const targets = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      moveAgent(agent, context, moveStream);
      const target = agent.movement.target;
      if (target) {
        targets.add(`${target.x.toFixed(2)}:${target.y.toFixed(2)}`);
      }
    }

    expect(agent.movement.behaviorId).toBe('wander');
    expect(targets.size).toBeGreaterThan(2);
  });

  it('patrol behavior cycles through waypoint loop', () => {
    const agent = createTestAgent({ traitFlags: ['territorial'] });
    const house: HouseState = {
      id: 'house-1',
      x: 30,
      y: 30,
      radius: 3,
      brain: createBrainState('HouseMind_v1'),
      brainNodeDuration: 6,
      brainDecision: null,
      members: [agent.id],
      activeDemand: {},
      stockpiles: { wood: 0 },
      construction: { active: false, progress: 0, required: 0, cooldownUntil: 0 },
      primaryLeaderId: null,
      leaders: [],
      leaderDirectives: {},
    };
    agent.houseId = house.id;
    agent.brain.currentNodeId = 'Patrol';
    agent.brain.nodeTimer = 0;

    const rng = createSeededRng('patrol-behavior');
    const context = createMovementContext(agent, house);
    const moveStream = rng.stream('move');

    const visitedTiles = new Set<string>();
    for (let i = 0; i < 80; i += 1) {
      moveAgent(agent, context, moveStream);
      visitedTiles.add(`${Math.floor(agent.x)}:${Math.floor(agent.y)}`);
    }

    expect(agent.movement.behaviorId).toBe('patrol');
    expect(agent.movement.waypoints).toBeTruthy();
    expect(agent.movement.waypoints?.length).toBeGreaterThanOrEqual(3);
    expect(visitedTiles.size).toBeGreaterThanOrEqual(3);
  });

  it('build-forage behavior targets forest tiles when houses demand wood', () => {
    const agent = createTestAgent();
    const rng = createSeededRng('build-behavior');
    const world = createWorld(64, 64, rng.stream('world'));
    const agentsById = new Map<string, MovableAgent>();
    agentsById.set(agent.id, agent);

    const house: HouseState = {
      id: 'house-demand',
      x: 52,
      y: 10,
      radius: 2,
      brain: createBrainState('HouseMind_v1'),
      brainNodeDuration: 6,
      brainDecision: null,
      members: [agent.id],
      activeDemand: { wood: 10 },
      stockpiles: { wood: 0 },
      construction: { active: false, progress: 0, required: 0, cooldownUntil: 0 },
      primaryLeaderId: null,
      leaders: [],
      leaderDirectives: {},
    };

    agent.houseId = house.id;
    agent.brain.currentNodeId = 'BuildDwelling';
    agent.brain.nodeTimer = 0;

    const context: MovementContext = {
      world,
      agentsById,
      housesById: new Map([[house.id, house]]),
      city: null,
      tick: 0,
    };

    const moveStream = rng.stream('move');
    let forestTargetSeen = false;
    for (let i = 0; i < 20; i += 1) {
      moveAgent(agent, context, moveStream);
      const target = agent.movement.target;
      if (target && isForestTile(world, target.x, target.y)) {
        forestTargetSeen = true;
        break;
      }
    }

    expect(forestTargetSeen).toBe(true);
  });
});
