import type { RngStream } from './rng.ts';
import type {
  ChromosomeDescriptor,
  ChromosomeRole,
  ScenarioChromosomeConfig,
} from '../../../../shared/types.ts';

export interface AgentChromosomes extends ChromosomeDescriptor {
  label: string;
  roles: ChromosomeRole[];
  metadata?: Record<string, unknown>;
}

export interface ChromosomeRegistryEntry extends AgentChromosomes {}

export interface ChromosomeRegistry {
  defaultCode: string;
  entries: Record<string, ChromosomeRegistryEntry>;
  spawnOrder: string[];
  spawnWeights: Record<string, number>;
}

const DEFAULT_CHROMOSOME_OPTIONS: ChromosomeDescriptor[] = [
  { code: 'XX', label: 'XX', roles: ['gestator'] },
  { code: 'XY', label: 'XY', roles: ['fertilizer'] },
];

const DEFAULT_SPAWN_WEIGHTS: Record<string, number> = {
  XX: 1,
  XY: 1,
};

function cloneMetadata<T>(metadata: T | undefined): T | undefined {
  if (metadata == null) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(metadata)) as T;
  } catch (error) {
    console.warn('Failed to clone chromosome metadata; dropping value.', error);
    return undefined;
  }
}

function normalizeRoles(roles?: ChromosomeRole[]): ChromosomeRole[] {
  if (!Array.isArray(roles)) {
    return [];
  }
  const unique = new Set<ChromosomeRole>();
  for (const role of roles) {
    if (typeof role === 'string' && role.trim().length > 0) {
      unique.add(role);
    }
  }
  return Array.from(unique);
}

function normalizeDescriptor(descriptor: ChromosomeDescriptor): ChromosomeRegistryEntry {
  const code = descriptor.code.trim();
  const label = descriptor.label && descriptor.label.trim().length > 0 ? descriptor.label : code;
  return {
    code,
    label,
    roles: normalizeRoles(descriptor.roles),
    metadata: cloneMetadata(descriptor.metadata),
  };
}

export function buildChromosomeRegistry(
  config?: ScenarioChromosomeConfig | null,
): ChromosomeRegistry {
  const entries: Record<string, ChromosomeRegistryEntry> = {};
  const spawnWeights: Record<string, number> = {};
  const spawnOrder: string[] = [];

  const registerDescriptor = (descriptor: ChromosomeDescriptor): void => {
    if (!descriptor || typeof descriptor.code !== 'string') {
      return;
    }
    const normalized = normalizeDescriptor(descriptor);
    entries[normalized.code] = normalized;
    if (!spawnOrder.includes(normalized.code)) {
      spawnOrder.push(normalized.code);
    }
    if (!(normalized.code in spawnWeights)) {
      const defaultWeight = DEFAULT_SPAWN_WEIGHTS[normalized.code] ?? 1;
      spawnWeights[normalized.code] = defaultWeight > 0 ? defaultWeight : 1;
    }
  };

  DEFAULT_CHROMOSOME_OPTIONS.forEach(registerDescriptor);

  if (config?.options) {
    for (const option of config.options) {
      registerDescriptor(option);
    }
  }

  if (config?.spawnWeights) {
    for (const [code, weight] of Object.entries(config.spawnWeights)) {
      if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && entries[code]) {
        spawnWeights[code] = weight;
      }
    }
  }

  const defaultCodeCandidate = config?.defaultCode;
  const defaultCode =
    defaultCodeCandidate && entries[defaultCodeCandidate]
      ? defaultCodeCandidate
      : spawnOrder[0] ?? DEFAULT_CHROMOSOME_OPTIONS[0].code;

  if (!spawnOrder.includes(defaultCode)) {
    spawnOrder.unshift(defaultCode);
  }

  return {
    defaultCode,
    entries,
    spawnOrder: [...spawnOrder],
    spawnWeights: { ...spawnWeights },
  };
}

function resolveWeight(code: string, registry: ChromosomeRegistry): number {
  const weight = registry.spawnWeights[code];
  if (!Number.isFinite(weight) || weight <= 0) {
    return 0;
  }
  return weight;
}

function cloneRegistryEntry(entry: ChromosomeRegistryEntry): ChromosomeRegistryEntry {
  return {
    code: entry.code,
    label: entry.label,
    roles: [...entry.roles],
    metadata: cloneMetadata(entry.metadata),
  };
}

export function cloneAgentChromosomes(chromosomes: AgentChromosomes): AgentChromosomes {
  return {
    code: chromosomes.code,
    label: chromosomes.label,
    roles: [...chromosomes.roles],
    metadata: cloneMetadata(chromosomes.metadata),
  };
}

export function cloneChromosomeRegistry(registry: ChromosomeRegistry): ChromosomeRegistry {
  const entries: Record<string, ChromosomeRegistryEntry> = {};
  for (const [code, entry] of Object.entries(registry.entries)) {
    entries[code] = cloneRegistryEntry(entry);
  }
  return {
    defaultCode: registry.defaultCode,
    entries,
    spawnOrder: [...registry.spawnOrder],
    spawnWeights: { ...registry.spawnWeights },
  };
}

export function sampleChromosomes(
  registry: ChromosomeRegistry,
  stream: RngStream,
): AgentChromosomes {
  if (!registry.spawnOrder.length) {
    const fallback = registry.entries[registry.defaultCode] ?? {
      code: registry.defaultCode,
      label: registry.defaultCode,
      roles: [],
    };
    return cloneAgentChromosomes(fallback);
  }

  let totalWeight = 0;
  const weights: number[] = [];
  for (const code of registry.spawnOrder) {
    const weight = resolveWeight(code, registry);
    weights.push(weight);
    totalWeight += weight;
  }

  const effectiveTotal = totalWeight > 0 ? totalWeight : registry.spawnOrder.length;
  let roll = stream.nextFloat() * effectiveTotal;

  for (let i = 0; i < registry.spawnOrder.length; i += 1) {
    const code = registry.spawnOrder[i];
    const entry = registry.entries[code];
    if (!entry) {
      continue;
    }
    const weight = totalWeight > 0 ? weights[i] : 1;
    if (weight <= 0) {
      continue;
    }
    roll -= weight;
    if (roll <= 0) {
      return cloneAgentChromosomes(entry);
    }
  }

  const fallbackEntry =
    registry.entries[registry.defaultCode] ??
    registry.entries[registry.spawnOrder[0]] ?? {
      code: registry.defaultCode,
      label: registry.defaultCode,
      roles: [],
    };
  return cloneAgentChromosomes(fallbackEntry);
}

export function ensureRolesArray(roles: ChromosomeRole[] | undefined): ChromosomeRole[] {
  if (!roles || roles.length === 0) {
    return [];
  }
  return [...new Set(roles)];
}
