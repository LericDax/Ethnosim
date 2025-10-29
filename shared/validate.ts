import type { BrainGraph, BrainNode, ScenarioConfig } from './types.js';
import babyMind from './brains/BabyMind_v1.json' with { type: 'json' };
import childMind from './brains/ChildMind_v1.json' with { type: 'json' };
import teenMind from './brains/TeenMind_v1.json' with { type: 'json' };
import adultMind from './brains/AdultMind_v1.json' with { type: 'json' };
import houseMind from './brains/HouseMind_v1.json' with { type: 'json' };
import urbanMind from './brains/UrbanMind_v1.json' with { type: 'json' };
import baselineScenario from './scenarios/baseline_small.json' with { type: 'json' };

interface NamedValue<T> {
  label: string;
  value: T;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function assertBrainNode(node: unknown, graphLabel: string): asserts node is BrainNode {
  if (typeof node !== 'object' || node === null) {
    throw new Error(`Brain node in ${graphLabel} is not an object.`);
  }

  const candidate = node as Record<string, unknown>;
  if (!isString(candidate.id)) {
    throw new Error(`Brain node in ${graphLabel} is missing a string id.`);
  }
  if (!isNumber(candidate.base_freq)) {
    throw new Error(`Brain node ${candidate.id} in ${graphLabel} has invalid base_freq.`);
  }
  if (!isNumber(candidate.duration) || candidate.duration <= 0) {
    throw new Error(`Brain node ${candidate.id} in ${graphLabel} has invalid duration.`);
  }
  if (!Array.isArray(candidate.tags) || !candidate.tags.every(isString)) {
    throw new Error(`Brain node ${candidate.id} in ${graphLabel} has invalid tags.`);
  }
}

function assertBrainGraph(graph: unknown, label: string): asserts graph is BrainGraph {
  if (typeof graph !== 'object' || graph === null) {
    throw new Error(`${label} is not an object.`);
  }

  const candidate = graph as Record<string, unknown>;
  if (!isNumber(candidate.version)) {
    throw new Error(`${label} is missing numeric version.`);
  }
  if (!isString(candidate.name)) {
    throw new Error(`${label} is missing name.`);
  }
  if (!Array.isArray(candidate.nodes) || candidate.nodes.length === 0) {
    throw new Error(`${label} must contain at least one node.`);
  }

  candidate.nodes.forEach((node) => assertBrainNode(node, label));
  const nodes = candidate.nodes as BrainNode[];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) {
    throw new Error(`${label} has duplicate node ids.`);
  }

  if (!Array.isArray(candidate.edges)) {
    throw new Error(`${label} has invalid edges array.`);
  }

  for (const edge of candidate.edges as unknown[]) {
    if (!Array.isArray(edge) || edge.length !== 3) {
      throw new Error(`${label} has an edge that is not [source,target,weight].`);
    }
    const [source, target, weight] = edge;
    if (!isString(source) || !nodeIds.has(source)) {
      throw new Error(`${label} edge has invalid source ${String(source)}.`);
    }
    if (!isString(target) || !nodeIds.has(target)) {
      throw new Error(`${label} edge has invalid target ${String(target)}.`);
    }
    if (!isNumber(weight) || weight <= 0) {
      throw new Error(`${label} edge ${source}→${target} has invalid weight.`);
    }
  }

  if (!isString(candidate.start_node) || !nodeIds.has(candidate.start_node)) {
    throw new Error(`${label} has invalid start_node.`);
  }
}

function assertScenarioConfig(config: unknown, label: string): asserts config is ScenarioConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error(`${label} is not an object.`);
  }

  const candidate = config as Record<string, unknown>;
  if (!isNumber(candidate.version)) {
    throw new Error(`${label} is missing numeric version.`);
  }
  if (!isString(candidate.name)) {
    throw new Error(`${label} is missing name.`);
  }

  const world = candidate.world as Record<string, unknown> | undefined;
  if (!world || typeof world !== 'object') {
    throw new Error(`${label} is missing world definition.`);
  }
  if (!isNumber(world.width) || world.width <= 0) {
    throw new Error(`${label} world has invalid width.`);
  }
  if (!isNumber(world.height) || world.height <= 0) {
    throw new Error(`${label} world has invalid height.`);
  }

  const terrain = world.terrain as Record<string, unknown> | undefined;
  if (!terrain || typeof terrain !== 'object') {
    throw new Error(`${label} world is missing terrain.`);
  }
  if (!isNumber(terrain.town_radius) || terrain.town_radius < 0) {
    throw new Error(`${label} world terrain has invalid town_radius.`);
  }
  if (!isNumber(terrain.plain_radius) || terrain.plain_radius < terrain.town_radius) {
    throw new Error(`${label} world terrain has invalid plain_radius.`);
  }

  const tick = candidate.tick as Record<string, unknown> | undefined;
  if (!tick || typeof tick !== 'object' || !isNumber(tick.minutes_per_tick) || tick.minutes_per_tick <= 0) {
    throw new Error(`${label} tick configuration is invalid.`);
  }

  const population = candidate.population as Record<string, unknown> | undefined;
  if (!population || typeof population !== 'object' || !isNumber(population.initial_adults) || population.initial_adults < 0) {
    throw new Error(`${label} population.initial_adults is invalid.`);
  }

  const authorities = candidate.authorities as Record<string, unknown> | undefined;
  if (!authorities || typeof authorities !== 'object') {
    throw new Error(`${label} is missing authorities.`);
  }

  const houses = authorities.houses as unknown;
  if (!Array.isArray(houses)) {
    throw new Error(`${label} authorities.houses must be an array.`);
  }
  houses.forEach((house, index) => {
    if (typeof house !== 'object' || house === null) {
      throw new Error(`${label} authorities.houses[${index}] is invalid.`);
    }
    const h = house as Record<string, unknown>;
    if (!isString(h.id)) {
      throw new Error(`${label} authorities.houses[${index}] missing id.`);
    }
    if (!isNumber(h.authority) || h.authority < 0) {
      throw new Error(`${label} authorities.houses[${index}] has invalid authority.`);
    }
  });

  const city = authorities.city as Record<string, unknown> | null | undefined;
  if (city !== null) {
    if (!city || typeof city !== 'object') {
      throw new Error(`${label} authorities.city must be null or object.`);
    }
    if (!isString(city.id)) {
      throw new Error(`${label} authorities.city missing id.`);
    }
    if (!isNumber(city.authority) || city.authority < 0) {
      throw new Error(`${label} authorities.city has invalid authority.`);
    }
  }
}

const brains: NamedValue<unknown>[] = [
  { label: 'BabyMind_v1.json', value: babyMind },
  { label: 'ChildMind_v1.json', value: childMind },
  { label: 'TeenMind_v1.json', value: teenMind },
  { label: 'AdultMind_v1.json', value: adultMind },
  { label: 'HouseMind_v1.json', value: houseMind },
  { label: 'UrbanMind_v1.json', value: urbanMind }
];

for (const { label, value } of brains) {
  assertBrainGraph(value, label);
}

assertScenarioConfig(baselineScenario, 'baseline_small.json');

console.log('Shared asset validation passed.');
