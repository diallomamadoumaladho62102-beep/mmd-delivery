/**
 * Config cache ports — Phase 0.
 * Phase 1+ will back these with memory/Redis; quotes must not thrash DB.
 */

export type CacheNamespace =
  | "rate_cards"
  | "pricing_rules"
  | "taxes"
  | "policies";

export interface IPricingConfigCache {
  get<T>(ns: CacheNamespace, key: string): Promise<T | null>;
  set<T>(
    ns: CacheNamespace,
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void>;
  invalidate(ns: CacheNamespace, key?: string): Promise<void>;
}

/** In-memory placeholder — unused by production charge paths in Phase 0. */
export function createMemoryPricingConfigCache(): IPricingConfigCache {
  const store = new Map<string, { expiresAt: number; value: unknown }>();
  const k = (ns: CacheNamespace, key: string) => `${ns}:${key}`;

  return {
    async get<T>(ns, key) {
      const hit = store.get(k(ns, key));
      if (!hit) return null;
      if (hit.expiresAt > 0 && Date.now() > hit.expiresAt) {
        store.delete(k(ns, key));
        return null;
      }
      return hit.value as T;
    },
    async set(ns, key, value, ttlSeconds = 300) {
      store.set(k(ns, key), {
        value,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0,
      });
    },
    async invalidate(ns, key) {
      if (key) {
        store.delete(k(ns, key));
        return;
      }
      for (const id of store.keys()) {
        if (id.startsWith(`${ns}:`)) store.delete(id);
      }
    },
  };
}
