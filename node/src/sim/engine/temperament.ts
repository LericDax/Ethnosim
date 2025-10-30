import type { Temperament } from '../sim.worker.ts';
import type { RngStream } from './rng.ts';

const TEMPERAMENT_NOISE_RANGE = 0.05;

const TEMPERAMENT_KEYS: Array<keyof Temperament> = [
  'trustBias',
  'fearBias',
  'loyaltyBias',
  'resentmentBias',
  'territorialBias',
  'zealBias',
];

const STRESS_ADJUSTMENTS: Partial<Record<keyof Temperament, number>> = {
  fearBias: 0.01,
  territorialBias: 0.005,
};

export function createFetusTemperament(
  a: Temperament,
  b: Temperament,
  rng: RngStream,
): Temperament {
  const temperament: Temperament = { ...a };
  for (const key of TEMPERAMENT_KEYS) {
    const average = (a[key] + b[key]) / 2;
    const noise = (rng.nextFloat() * 2 - 1) * TEMPERAMENT_NOISE_RANGE;
    temperament[key] = clamp01(average + noise);
  }
  return temperament;
}

export function applyGestationalStress(
  temperament: Temperament,
  stress: number,
): void {
  if (stress <= 0) {
    return;
  }

  for (const [key, multiplier] of Object.entries(STRESS_ADJUSTMENTS) as Array<
    [keyof Temperament, number]
  >) {
    temperament[key] = clamp01(temperament[key] + multiplier * stress);
  }
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}
