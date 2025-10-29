import { RNG, createRng } from './rng.js';
import { createBrainState, getBrainGraph } from './brains.js';
import { createInitialMoods } from './moods.js';

export const TEMPERAMENT_KEYS = [
  'trust_bias',
  'fear_bias',
  'loyalty_bias',
  'resentment_bias',
  'territorial_bias',
  'zeal_bias',
];

let nextAgentIndex = 1;

export function resetAgentIds() {
  nextAgentIndex = 1;
}

export function generateAgentId() {
  return `A${nextAgentIndex++}`;
}

/**
 * Creates starting adults, houses, and a city brain around the world center.
 * @param {number|RNG} seedOrRng
 * @param {{w:number,h:number,cx:number,cy:number}} world
 * @param {number} n
 */
export function spawnInitialAdults(seedOrRng, world, n = 6) {
  const rng = seedOrRng instanceof RNG ? seedOrRng : createRng(seedOrRng ?? 1);
  resetAgentIds();

  const agents = [];
  const houseCount = Math.max(1, Math.round(n / 3));
  const houses = [];
  for (let i = 0; i < houseCount; i++) {
    const hx = clamp(Math.round(world.cx + rng.nextRange(-4, 4)), 0, world.w - 1);
    const hy = clamp(Math.round(world.cy + rng.nextRange(-4, 4)), 0, world.h - 1);
    houses.push({
      id: `H${i + 1}`,
      x: hx,
      y: hy,
      authority: 0.4 + rng.nextRange(0, 0.3),
      members: [],
      brain: createBrainState('HouseMind_v1'),
    });
  }

  const city = {
    id: 'C1',
    x: Math.round(world.cx),
    y: Math.round(world.cy),
    authority: 0.7,
    brain: createBrainState('UrbanMind_v1'),
  };

  for (let i = 0; i < n; i++) {
    const house = houses[i % houses.length];
    const agent = createAdultAgent(rng, world, house);
    agents.push(agent);
    house.members.push(agent.id);
  }

  pairBondAdults(agents, rng);

  return { agents, houses, city, rng };
}

function createAdultAgent(rng, world, house) {
  const id = generateAgentId();
  const sex = rng.nextFloat() < 0.5 ? 'female' : 'male';
  const genderRoll = rng.nextFloat();
  let gender;
  if (genderRoll < 0.4) gender = 'man';
  else if (genderRoll < 0.8) gender = 'woman';
  else gender = 'nonbinary';

  const temperament = createTemperament(rng);
  const brain = createBrainState('AdultMind_v1');
  brain.current_node = 'Gather';
  brain.node_timer = getBrainGraph('AdultMind_v1').nodesById.get('Gather').duration;

  return {
    id,
    x: clamp(Math.round(world.cx + rng.nextRange(-6, 6)), 0, world.w - 1),
    y: clamp(Math.round(world.cy + rng.nextRange(-6, 6)), 0, world.h - 1),
    age_stage: 'adult',
    age_ticks: Math.floor(rng.nextRange(0, 200)),
    sex_body: sex,
    gender_identity: gender,
    fertility: sex === 'female' ? rng.nextRange(0.4, 0.9) : 0,
    pregnant: null,
    bond_partner_id: null,
    temperament,
    moods: createInitialMoods(),
    brain,
    house_id: house.id,
    city_id: 'C1',
    parents: [],
    primary_caregiver_id: null,
    children: [],
  };
}

function pairBondAdults(agents, rng) {
  const females = agents.filter((a) => a.sex_body === 'female');
  const males = agents.filter((a) => a.sex_body === 'male');
  shuffleInPlace(males, rng);
  const pairCount = Math.min(females.length, males.length);
  for (let i = 0; i < pairCount; i++) {
    if (rng.nextFloat() < 0.7) {
      const f = females[i];
      const m = males[i];
      f.bond_partner_id = m.id;
      m.bond_partner_id = f.id;
    }
  }
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.nextFloat() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function createTemperament(rng) {
  const temperament = {};
  for (const key of TEMPERAMENT_KEYS) {
    temperament[key] = clamp01(0.2 + rng.nextRange(0, 0.5));
  }
  return temperament;
}

export function averageTemperament(a, b) {
  const result = {};
  for (const key of TEMPERAMENT_KEYS) {
    result[key] = clamp01(((a?.[key] ?? 0.5) + (b?.[key] ?? 0.5)) / 2);
  }
  return result;
}

export function jitterTemperament(base, rng, magnitude = 0.05) {
  const result = {};
  for (const key of TEMPERAMENT_KEYS) {
    const noise = rng.nextRange(-magnitude, magnitude);
    result[key] = clamp01((base?.[key] ?? 0.5) + noise);
  }
  return result;
}

export function cloneTemperament(source) {
  const result = {};
  for (const key of TEMPERAMENT_KEYS) {
    result[key] = clamp01(source?.[key] ?? 0.5);
  }
  return result;
}

export function temperamentMultiplier(temperament, node) {
  if (!node?.tags) return 1;
  let multiplier = 1;
  for (const tag of node.tags) {
    switch (tag) {
      case 'social':
      case 'home':
      case 'inward':
        multiplier *= 1 + (temperament.trust_bias - 0.5) * 0.5;
        break;
      case 'outward':
      case 'risk':
      case 'territorial':
      case 'guard':
        multiplier *= 1 + (temperament.territorial_bias - 0.5) * 0.6;
        break;
      case 'ritual':
      case 'loyalty':
      case 'doctrine':
        multiplier *= 1 + (temperament.zeal_bias - 0.5) * 0.7;
        break;
      case 'selfish':
      case 'resentment':
        multiplier *= 1 + (temperament.resentment_bias - 0.5) * 0.5;
        break;
      case 'fear':
      case 'alert':
        multiplier *= 1 + (temperament.fear_bias - 0.5) * 0.5;
        break;
      default:
        multiplier *= 1 + (temperament.loyalty_bias - 0.5) * 0.2;
        break;
    }
  }
  return Math.max(0.1, multiplier);
}

export function clampTemperament(temp) {
  const result = {};
  for (const key of TEMPERAMENT_KEYS) {
    result[key] = clamp01(temp[key]);
  }
  return result;
}

export function createNewborn(mother, temperament, rng) {
  const id = generateAgentId();
  const brain = createBrainState('BabyMind_v1');
  return {
    id,
    x: mother.x,
    y: mother.y,
    age_stage: 'baby',
    age_ticks: 0,
    sex_body: rng.nextFloat() < 0.5 ? 'female' : 'male',
    gender_identity: 'undetermined',
    fertility: 0,
    pregnant: null,
    bond_partner_id: null,
    temperament: clampTemperament(temperament),
    moods: createInitialMoods(),
    brain,
    house_id: mother.house_id,
    city_id: mother.city_id,
    parents: [mother.id, mother.pregnant?.co_parent_id ?? null].filter(Boolean),
    primary_caregiver_id: mother.id,
    children: [],
  };
}

export function findAgent(agents, id) {
  return agents.find((a) => a.id === id);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
