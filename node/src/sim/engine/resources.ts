export type ResourceType = 'wood' | 'forage' | 'ore';

export const RESOURCE_TYPES: readonly ResourceType[] = ['wood', 'forage', 'ore'] as const;

export type ResourceBundle = Partial<Record<ResourceType, number>>;

export function createResourceBundle(initial?: ResourceBundle | null): ResourceBundle {
  const bundle: ResourceBundle = {};
  if (initial) {
    for (const [key, value] of Object.entries(initial)) {
      const type = key as ResourceType;
      if (!isResourceType(type)) {
        continue;
      }
      const amount = sanitizeResourceAmount(value);
      if (amount > 0) {
        bundle[type] = amount;
      }
    }
  }
  ensureBundleKeys(bundle);
  return bundle;
}

export function ensureResourceBundle(bundle?: ResourceBundle | null): ResourceBundle {
  const target = bundle ?? {};
  ensureBundleKeys(target);
  return target;
}

export function cloneResourceBundle(bundle?: ResourceBundle | null): ResourceBundle {
  if (!bundle) {
    return createResourceBundle();
  }
  const clone: ResourceBundle = {};
  for (const [key, value] of Object.entries(bundle)) {
    const type = key as ResourceType;
    if (!isResourceType(type)) {
      continue;
    }
    clone[type] = sanitizeResourceAmount(value);
  }
  ensureBundleKeys(clone);
  return clone;
}

export function sanitizeResourceAmount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric < 0 ? 0 : numeric;
}

export function getResourceAmount(bundle: ResourceBundle | null | undefined, type: ResourceType): number {
  if (!bundle) {
    return 0;
  }
  return sanitizeResourceAmount(bundle[type]);
}

export function addResourceAmount(
  bundle: ResourceBundle,
  type: ResourceType,
  delta: number,
  options: { capacity?: number | null } = {},
): number {
  const amount = sanitizeResourceAmount(delta);
  if (amount <= 0) {
    ensureBundleKeys(bundle);
    return getResourceAmount(bundle, type);
  }
  const current = getResourceAmount(bundle, type);
  const capacity = Number.isFinite(options.capacity) && (options.capacity ?? 0) > 0 ? options.capacity ?? 0 : null;
  const next = capacity !== null ? Math.min(capacity, current + amount) : current + amount;
  bundle[type] = next;
  ensureBundleKeys(bundle);
  return next;
}

export function removeResourceAmount(
  bundle: ResourceBundle,
  type: ResourceType,
  delta: number,
): number {
  const amount = sanitizeResourceAmount(delta);
  if (amount <= 0) {
    ensureBundleKeys(bundle);
    return 0;
  }
  const current = getResourceAmount(bundle, type);
  const removed = Math.min(current, amount);
  bundle[type] = current - removed;
  ensureBundleKeys(bundle);
  return removed;
}

function ensureBundleKeys(bundle: ResourceBundle): void {
  for (const type of RESOURCE_TYPES) {
    const amount = sanitizeResourceAmount(bundle[type]);
    if (amount > 0) {
      bundle[type] = amount;
    } else {
      bundle[type] = 0;
    }
  }
}

function isResourceType(value: string): value is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(value);
}
