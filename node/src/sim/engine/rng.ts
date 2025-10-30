export interface RngStream {
  nextUint32(): number;
  nextFloat(): number;
}

export interface SeededRng {
  stream(label: string): RngStream;
  spawn(label: string): SeededRng;
}

const MOD_MASK = (1n << 64n) - 1n;
const DEFAULT_SEED = 0x853c49e6748fea9bn;
const MULTIPLIER = 6364136223846793005n;

class Pcg32 implements RngStream {
  private state: bigint;
  private readonly increment: bigint;

  constructor(seed: bigint, sequence: bigint) {
    this.state = ((seed & MOD_MASK) + DEFAULT_SEED) & MOD_MASK;
    this.increment = ((sequence << 1n) | 1n) & MOD_MASK;
  }

  nextUint32(): number {
    const oldState = this.state;
    this.state = (oldState * MULTIPLIER + this.increment) & MOD_MASK;
    const xorshifted = Number(((oldState >> 18n) ^ oldState) >> 27n) >>> 0;
    const rot = Number(oldState >> 59n) & 31;
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }
}

function normalizeSeed(seed?: number | string | bigint | null): bigint {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed)) {
      return DEFAULT_SEED;
    }
    return BigInt(Math.floor(seed)) & MOD_MASK;
  }
  if (typeof seed === 'bigint') {
    return seed & MOD_MASK;
  }
  if (typeof seed === 'string' && seed.length > 0) {
    return fnv1a64(seed);
  }
  return DEFAULT_SEED;
}

function fnv1a64(value: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= BigInt(value.charCodeAt(i) & 0xff);
    hash = (hash * 0x100000001b3n) & MOD_MASK;
  }
  return hash & MOD_MASK;
}

function mix64(value: bigint): bigint {
  let z = (value + 0x9e3779b97f4a7c15n) & MOD_MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MOD_MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MOD_MASK;
  z ^= z >> 31n;
  return z & MOD_MASK;
}

function createSeededRngFromBigInt(seed: bigint): SeededRng {
  const normalizedSeed = seed & MOD_MASK;
  const streamCache = new Map<string, Pcg32>();
  const childCache = new Map<string, SeededRng>();

  function deriveSequence(labelHash: bigint): bigint {
    return mix64(normalizedSeed + labelHash + 0x9e3779b97f4a7c15n);
  }

  function deriveSeed(labelHash: bigint): bigint {
    return mix64(normalizedSeed ^ labelHash ^ 0x14057b7ef767814fn);
  }

  function deriveChild(labelHash: bigint): bigint {
    return mix64(normalizedSeed ^ labelHash ^ 0xd2a80a9f892525b5n);
  }

  return {
    stream(label: string): RngStream {
      if (!streamCache.has(label)) {
        const labelHash = fnv1a64(label);
        const stream = new Pcg32(deriveSeed(labelHash), deriveSequence(labelHash));
        streamCache.set(label, stream);
      }
      return streamCache.get(label)!;
    },
    spawn(label: string): SeededRng {
      if (!childCache.has(label)) {
        const labelHash = fnv1a64(label);
        childCache.set(label, createSeededRngFromBigInt(deriveChild(labelHash)));
      }
      return childCache.get(label)!;
    },
  };
}

export function createSeededRng(seed?: number | string | bigint | null): SeededRng {
  const normalized = normalizeSeed(seed);
  return createSeededRngFromBigInt(normalized);
}
