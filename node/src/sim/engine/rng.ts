import type { SerializedSimulationRng } from '../io/save.ts';
import type { RandomnessMode } from '../sim.worker.ts';

export interface SerializedRngStream {
  state: string;
  increment: string;
}

export interface SerializedSeededRng {
  seed: string;
  streams: Record<string, SerializedRngStream>;
  children: Record<string, SerializedSeededRng>;
}

export interface RngStream {
  nextUint32(): number;
  nextFloat(): number;
  serialize(): SerializedRngStream;
  restore(serialized: SerializedRngStream): void;
}

export interface SeededRng {
  stream(label: string): RngStream;
  spawn(label: string): SeededRng;
  serialize(): SerializedSeededRng;
}

interface CryptoLike {
  getRandomValues?(array: Uint32Array): Uint32Array;
}

const MOD_MASK = (1n << 64n) - 1n;
const DEFAULT_SEED = 0x853c49e6748fea9bn;
const MULTIPLIER = 6364136223846793005n;

class Pcg32 implements RngStream {
  private state: bigint;
  private increment: bigint;

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

  serialize(): SerializedRngStream {
    return {
      state: this.state.toString(),
      increment: this.increment.toString(),
    };
  }

  restore(serialized: SerializedRngStream): void {
    if (serialized?.state) {
      this.state = BigInt(serialized.state) & MOD_MASK;
    }
    if (serialized?.increment) {
      this.increment = BigInt(serialized.increment) & MOD_MASK;
    }
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

function createSeededRngInternal(seed: bigint, snapshot: SerializedSeededRng | null): SeededRng {
  const normalizedSeed = seed & MOD_MASK;
  const streamCache = new Map<string, Pcg32>();
  const childCache = new Map<string, SeededRng>();
  const streamSnapshots = snapshot?.streams ?? {};
  const childSnapshots = snapshot?.children ?? {};

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
        const snapshotState = streamSnapshots[label];
        if (snapshotState) {
          stream.restore(snapshotState);
        }
        streamCache.set(label, stream);
      }
      return streamCache.get(label)!;
    },
    spawn(label: string): SeededRng {
      if (!childCache.has(label)) {
        const labelHash = fnv1a64(label);
        const childSnapshot = childSnapshots[label] ?? null;
        childCache.set(label, createSeededRngInternal(deriveChild(labelHash), childSnapshot));
      }
      return childCache.get(label)!;
    },
    serialize(): SerializedSeededRng {
      const streams: Record<string, SerializedRngStream> = {};
      for (const [label, stream] of streamCache.entries()) {
        streams[label] = stream.serialize();
      }

      const children: Record<string, SerializedSeededRng> = {};
      for (const [label, child] of childCache.entries()) {
        children[label] = child.serialize();
      }

      return {
        seed: normalizedSeed.toString(),
        streams,
        children,
      };
    },
  };
}

export function createSeededRng(seed?: number | string | bigint | null): SeededRng {
  const normalized = normalizeSeed(seed);
  return createSeededRngInternal(normalized, null);
}

export function restoreSeededRng(serialized: SerializedSeededRng): SeededRng {
  const seed = serialized?.seed ? BigInt(serialized.seed) & MOD_MASK : DEFAULT_SEED;
  return createSeededRngInternal(seed, serialized ?? null);
}

class ChaoticStream implements RngStream {
  nextUint32(): number {
    return randomUint32();
  }

  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  serialize(): SerializedRngStream {
    return { state: 'chaotic', increment: 'chaotic' };
  }

  // Chaotic streams are stateless; restoring is a no-op.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  restore(_serialized: SerializedRngStream): void {}
}

class ChaoticSeededRng implements SeededRng {
  private streamCache = new Map<string, ChaoticStream>();

  private childCache = new Map<string, SeededRng>();

  stream(label: string): RngStream {
    if (!this.streamCache.has(label)) {
      this.streamCache.set(label, new ChaoticStream());
    }
    return this.streamCache.get(label)!;
  }

  spawn(label: string): SeededRng {
    if (!this.childCache.has(label)) {
      this.childCache.set(label, new ChaoticSeededRng());
    }
    return this.childCache.get(label)!;
  }

  serialize(): SerializedSeededRng {
    return { seed: 'chaotic', streams: {}, children: {} };
  }
}

function randomUint32(): number {
  const cryptoLike =
    typeof globalThis === 'object' && globalThis
      ? (globalThis as { crypto?: CryptoLike }).crypto
      : undefined;
  if (cryptoLike && typeof cryptoLike.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    cryptoLike.getRandomValues(buffer);
    return buffer[0]! >>> 0;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

function createChaoticSeededRng(): SeededRng {
  return new ChaoticSeededRng();
}

export function createModeAwareSeededRng(
  mode: RandomnessMode,
  seed?: number | string | bigint | null,
): SeededRng {
  return mode === 'chaotic' ? createChaoticSeededRng() : createSeededRng(seed);
}

export function restoreModeAwareSeededRng(
  mode: RandomnessMode,
  serialized: SerializedSeededRng,
): SeededRng {
  return mode === 'chaotic' ? createChaoticSeededRng() : restoreSeededRng(serialized);
}

export interface ModeAwareSimulationRng {
  root: SeededRng;
  world: RngStream;
  agentSpawn: RngStream;
  tick: RngStream;
  collectives: RngStream;
}

export function createModeAwareRngSuite(
  mode: RandomnessMode,
  seed?: number | string | bigint | null,
): ModeAwareSimulationRng {
  const root = createModeAwareSeededRng(mode, seed);
  return {
    root,
    world: root.stream('world'),
    agentSpawn: root.stream('agent-spawn'),
    tick: root.stream('tick'),
    collectives: root.stream('collectives'),
  };
}

export function restoreModeAwareRngSuite(
  mode: RandomnessMode,
  serialized: SerializedSimulationRng,
): ModeAwareSimulationRng {
  const root = restoreModeAwareSeededRng(mode, serialized.root);
  const world = root.stream('world');
  world.restore(serialized.streams.world);
  const agentSpawn = root.stream('agent-spawn');
  agentSpawn.restore(serialized.streams.agentSpawn);
  const tick = root.stream('tick');
  tick.restore(serialized.streams.tick);
  const collectives = root.stream('collectives');
  collectives.restore(serialized.streams.collectives);
  return { root, world, agentSpawn, tick, collectives };
}
