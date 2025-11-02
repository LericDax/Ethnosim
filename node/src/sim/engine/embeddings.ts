export const EMBEDDING_SIZE = 8;

export type EmbeddingVector = number[];

const RAW_BASE_TAG_EMBEDDINGS: Record<string, number[]> = {
  need: [0.92, 0.28, 0.2, -0.18, 0.1, 0.32, -0.12, -0.08],
  social: [0.25, 0.94, 0.16, -0.1, 0.22, 0.24, 0.06, 0.12],
  rest: [0.14, 0.18, 0.95, -0.22, 0.04, -0.08, -0.18, -0.12],
  fear: [-0.28, -0.14, -0.26, 0.96, 0.05, 0.14, 0.28, 0.18],
  alert: [-0.18, -0.06, -0.18, 0.9, 0.08, 0.18, 0.32, 0.22],
  learn: [0.16, 0.26, 0.12, -0.08, 0.96, 0.22, 0.14, 0.08],
  curiosity: [0.12, 0.22, 0.08, -0.04, 0.92, 0.14, 0.12, 0.42],
  duty: [0.26, 0.24, 0.18, -0.02, 0.1, 0.96, 0.38, 0.24],
  loyalty: [0.3, 0.48, 0.2, -0.04, 0.12, 0.9, 0.28, 0.18],
  ritual: [0.14, 0.2, 0.1, -0.02, 0.36, 0.48, 0.95, 0.12],
  home: [0.6, 0.42, 0.78, -0.18, 0.08, 0.24, 0.18, -0.16],
  outward: [0.04, 0.36, -0.04, 0.28, 0.22, 0.26, 0.22, 0.94],
  inward: [0.42, 0.28, 0.5, -0.16, 0.18, 0.32, 0.26, -0.32],
  help: [0.84, 0.46, 0.2, -0.16, 0.12, 0.58, -0.06, -0.02],
  care: [0.9, 0.32, 0.24, -0.18, 0.08, 0.46, -0.14, -0.1],
  gathering: [0.52, 0.3, 0.18, -0.04, 0.18, 0.62, 0.12, 0.28],
  resource: [0.42, 0.22, 0.12, 0.02, 0.14, 0.74, 0.24, 0.26],
  work: [0.36, 0.18, 0.06, 0.04, 0.12, 0.86, 0.22, 0.18],
  stockpile: [0.32, 0.12, 0.18, -0.02, 0.08, 0.78, 0.42, 0.16],
  build: [0.28, 0.14, 0.16, 0.06, 0.22, 0.82, 0.38, 0.32],
  authority: [0.12, 0.22, 0.08, 0.12, 0.18, 0.46, 0.92, 0.18],
  control: [0.08, 0.18, 0.06, 0.22, 0.12, 0.52, 0.94, 0.2],
  doctrine: [0.1, 0.2, 0.08, 0.06, 0.32, 0.48, 0.92, 0.18],
  ideology: [0.08, 0.24, 0.04, 0.08, 0.38, 0.44, 0.9, 0.22],
  honor: [0.24, 0.32, 0.12, 0.12, 0.18, 0.86, 0.48, 0.24],
  status: [0.2, 0.34, 0.08, 0.16, 0.16, 0.68, 0.66, 0.28],
  legacy: [0.28, 0.24, 0.12, 0.14, 0.42, 0.58, 0.64, 0.26],
  lineage: [0.32, 0.22, 0.16, 0.18, 0.38, 0.62, 0.58, 0.22],
  future: [0.18, 0.3, 0.1, 0.08, 0.86, 0.44, 0.36, 0.34],
  future_pair: [0.3, 0.36, 0.12, 0.1, 0.78, 0.48, 0.38, 0.36],
  youth: [0.34, 0.38, 0.2, 0.04, 0.62, 0.32, 0.28, 0.48],
  bonding: [0.58, 0.62, 0.22, -0.04, 0.24, 0.56, 0.18, 0.16],
  patrol: [0.24, 0.28, 0.06, 0.54, 0.18, 0.42, 0.36, 0.72],
  guard: [0.32, 0.34, 0.1, 0.66, 0.12, 0.48, 0.44, 0.58],
  defense: [0.24, 0.3, 0.12, 0.78, 0.14, 0.46, 0.42, 0.44],
  retaliation: [0.12, 0.12, -0.08, 0.9, 0.06, 0.32, 0.38, 0.48],
  conflict: [0.08, 0.14, -0.12, 0.86, 0.08, 0.36, 0.34, 0.62],
  strategy: [0.22, 0.26, 0.06, 0.32, 0.74, 0.54, 0.46, 0.52],
  border: [0.16, 0.2, 0.02, 0.62, 0.18, 0.38, 0.46, 0.78],
  territorial: [0.12, 0.18, 0.06, 0.68, 0.14, 0.34, 0.48, 0.82],
  recruit: [0.32, 0.44, 0.08, 0.24, 0.5, 0.58, 0.42, 0.62],
  resentment: [-0.22, -0.12, -0.16, 0.58, 0.1, 0.24, 0.42, 0.36],
  selfish: [-0.32, -0.3, -0.18, 0.28, 0.06, 0.18, 0.24, 0.22],
  risk: [0.08, 0.12, -0.06, 0.82, 0.22, 0.34, 0.32, 0.68],
  wander: [0.18, 0.46, 0.04, 0.24, 0.4, 0.26, 0.18, 0.86],
  birth: [0.82, 0.32, 0.42, -0.12, 0.24, 0.48, 0.16, 0.08],
  safety: [0.46, 0.42, 0.32, -0.12, 0.12, 0.38, 0.32, 0.22],
  gather: [0.52, 0.28, 0.18, -0.02, 0.2, 0.64, 0.12, 0.3],
};

const BASE_TAG_EMBEDDINGS: Record<string, ReadonlyArray<number>> = Object.fromEntries(
  Object.entries(RAW_BASE_TAG_EMBEDDINGS).map(([tag, values]) => [tag, normalizeEmbedding(values)]),
);

export function createZeroEmbedding(): EmbeddingVector {
  return Array(EMBEDDING_SIZE).fill(0);
}

export function cloneEmbedding(vector: ReadonlyArray<number> | null | undefined): EmbeddingVector {
  const clone = createZeroEmbedding();
  if (!Array.isArray(vector)) {
    return clone;
  }
  const limit = Math.min(vector.length, EMBEDDING_SIZE);
  for (let i = 0; i < limit; i += 1) {
    const value = Number(vector[i]);
    clone[i] = Number.isFinite(value) ? value : 0;
  }
  return clone;
}

export function normalizeEmbedding(vector: ReadonlyArray<number>): EmbeddingVector {
  const magnitude = vectorMagnitude(vector);
  if (magnitude <= 1e-6) {
    return createZeroEmbedding();
  }
  const normalized = createZeroEmbedding();
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    const value = vector[i] ?? 0;
    normalized[i] = Number.isFinite(value) ? value / magnitude : 0;
  }
  return normalized;
}

export function vectorMagnitude(vector: ReadonlyArray<number>): number {
  let sum = 0;
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    const value = Number(vector[i]) || 0;
    sum += value * value;
  }
  return Math.sqrt(sum);
}

export function isZeroEmbedding(vector: ReadonlyArray<number> | null | undefined): boolean {
  if (!Array.isArray(vector)) {
    return true;
  }
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    if (Math.abs(Number(vector[i]) || 0) > 1e-6) {
      return false;
    }
  }
  return true;
}

export function dotProduct(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let sum = 0;
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    sum += av * bv;
  }
  return sum;
}

export function scaleEmbedding(target: EmbeddingVector, scalar: number): EmbeddingVector {
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    target[i] *= scalar;
  }
  return target;
}

export function addScaledEmbedding(
  target: EmbeddingVector,
  source: ReadonlyArray<number>,
  weight: number,
): EmbeddingVector {
  if (!Number.isFinite(weight) || weight === 0) {
    return target;
  }
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    const contribution = (Number(source[i]) || 0) * weight;
    target[i] += contribution;
  }
  return target;
}

export function resolveTagEmbedding(tag: string): ReadonlyArray<number> {
  const normalizedTag = tag?.trim().toLowerCase();
  if (normalizedTag && BASE_TAG_EMBEDDINGS[normalizedTag]) {
    return BASE_TAG_EMBEDDINGS[normalizedTag];
  }
  return HASHED_TAG_CACHE.get(normalizedTag ?? tag) ?? hashEmbeddingForTag(normalizedTag ?? tag);
}

const HASHED_TAG_CACHE = new Map<string, ReadonlyArray<number>>();

function hashEmbeddingForTag(tag: string): ReadonlyArray<number> {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tag.length; i += 1) {
    hash ^= tag.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 16777619);
  }
  const values: number[] = [];
  let state = hash >>> 0;
  for (let i = 0; i < EMBEDDING_SIZE; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    const normalized = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    values.push(normalized * 2 - 1);
  }
  const normalized = normalizeEmbedding(values);
  HASHED_TAG_CACHE.set(tag, normalized);
  return normalized;
}

export function combineTagEmbeddings(tags: ReadonlyArray<string> | null | undefined): EmbeddingVector {
  if (!Array.isArray(tags) || tags.length === 0) {
    return createZeroEmbedding();
  }
  const accumulator = createZeroEmbedding();
  let count = 0;
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag.length === 0) {
      continue;
    }
    addScaledEmbedding(accumulator, resolveTagEmbedding(tag), 1);
    count += 1;
  }
  if (count <= 0) {
    return accumulator;
  }
  scaleEmbedding(accumulator, 1 / count);
  return normalizeEmbedding(accumulator);
}

export function embeddingFromTagWeights(
  weights: Record<string, number> | null | undefined,
  scale = 1,
): EmbeddingVector {
  const accumulator = createZeroEmbedding();
  if (!weights || typeof weights !== 'object') {
    return accumulator;
  }
  let totalWeight = 0;
  for (const [tag, value] of Object.entries(weights)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    const intensity = Math.log(numeric);
    if (!Number.isFinite(intensity) || Math.abs(intensity) < 1e-4) {
      continue;
    }
    addScaledEmbedding(accumulator, resolveTagEmbedding(tag), intensity * scale);
    totalWeight += Math.abs(intensity * scale);
  }
  if (totalWeight > 1e-6) {
    scaleEmbedding(accumulator, 1 / totalWeight);
  }
  return normalizeEmbedding(accumulator);
}

export function coerceEmbedding(value: unknown): EmbeddingVector {
  if (!Array.isArray(value)) {
    return createZeroEmbedding();
  }
  return cloneEmbedding(value);
}
