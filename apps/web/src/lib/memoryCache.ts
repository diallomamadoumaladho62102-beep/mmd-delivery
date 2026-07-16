/**
 * Lightweight in-memory TTL cache for hot API / Mapbox responses.
 * Process-local only (fine for single Node instance / serverless warm invokes).
 */

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const store = new Map<string, CacheEntry<unknown>>();

export function cacheGet<T>(key: string): T | null {
  const row = store.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    store.delete(key);
    return null;
  }
  return row.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const ttl = Math.max(0, Math.floor(ttlMs));
  if (ttl <= 0) return;
  store.set(key, { value, expiresAt: Date.now() + ttl });
  // Soft bound to avoid unbounded growth on long-lived workers.
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) store.delete(k);
      if (store.size <= 400) break;
    }
  }
}

export function cacheWrap<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== null) return Promise.resolve(hit);
  return producer().then((value) => {
    cacheSet(key, value, ttlMs);
    return value;
  });
}

/** Test helper */
export function cacheClearForTests(): void {
  store.clear();
}

export function cacheSizeForTests(): number {
  return store.size;
}
