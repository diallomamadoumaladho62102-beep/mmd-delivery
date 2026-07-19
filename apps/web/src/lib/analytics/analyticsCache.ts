type CacheEntry<T> = { expiresAt: number; value: T };

const store = new Map<string, CacheEntry<unknown>>();

export function analyticsCacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function analyticsCacheSet<T>(key: string, value: T, ttlMs = 30_000) {
  store.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function analyticsCacheInvalidate(prefix?: string) {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function analyticsCacheKey(
  module: string,
  filters: Record<string, unknown>
): string {
  return `analytics:${module}:${JSON.stringify(filters)}`;
}
