/**
 * Shared in-memory sliding-window rate limiter for API abuse protection.
 * Per-instance on Vercel (defense in depth; pair with edge/WAF for scale).
 */

export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfterSec: number;
};

type Bucket = Map<string, number[]>;

const stores = globalThis as typeof globalThis & {
  __mmdApiRateLimitStores?: Map<string, Bucket>;
};

function getStore(namespace: string): Bucket {
  if (!stores.__mmdApiRateLimitStores) {
    stores.__mmdApiRateLimitStores = new Map();
  }
  let bucket = stores.__mmdApiRateLimitStores.get(namespace);
  if (!bucket) {
    bucket = new Map();
    stores.__mmdApiRateLimitStores.set(namespace, bucket);
  }
  return bucket;
}

function pruneAndCount(store: Bucket, key: string, now: number, windowMs: number): number {
  const windowStart = now - windowMs;
  const existing = store.get(key) ?? [];
  const pruned = existing.filter((ts) => ts >= windowStart);
  pruned.push(now);
  store.set(key, pruned);
  return pruned.length;
}

export function checkRateLimit(params: {
  namespace: string;
  key: string;
  limit: number;
  windowMs?: number;
}): RateLimitResult {
  const windowMs = params.windowMs ?? 60_000;
  const now = Date.now();
  const store = getStore(params.namespace);
  const count = pruneAndCount(store, params.key, now, windowMs);
  const limited = count > params.limit;
  return {
    limited,
    remaining: Math.max(0, params.limit - count),
    retryAfterSec: limited ? Math.ceil(windowMs / 1000) : 0,
  };
}

export function getRequestClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Path classification for proxy rate tiers. */
export type ApiRateTier =
  | "webhook"
  | "money"
  | "location"
  | "auth_sensitive"
  | "default"
  | "exempt";

export function classifyApiPath(pathname: string): ApiRateTier {
  const p = pathname.toLowerCase();

  if (
    p.startsWith("/api/cron/") ||
    p === "/api/admin/process-payouts" ||
    p === "/api/orders/expire-unpaid" ||
    p === "/api/monitoring" ||
    p.startsWith("/api/monitoring/")
  ) {
    return "exempt";
  }

  if (
    p.startsWith("/api/payments/webhook") ||
    p === "/api/stripe/webhook" ||
    p.startsWith("/api/stripe/webhook/")
  ) {
    return "webhook";
  }

  if (
    p.startsWith("/api/stripe/") ||
    p.startsWith("/api/payments/") ||
    p.includes("checkout") ||
    p.includes("payout") ||
    p.includes("refund") ||
    p.startsWith("/api/orders/delivered-confirm") ||
    p.startsWith("/api/delivery-requests/delivered-confirm") ||
    p.startsWith("/api/taxi/rides/quote") ||
    p.startsWith("/api/taxi/rides/create")
  ) {
    return "money";
  }

  if (
    p.startsWith("/api/locations") ||
    p.startsWith("/api/mapbox") ||
    p.startsWith("/api/driver/location") ||
    p.includes("geocode")
  ) {
    return "location";
  }

  if (
    p.startsWith("/api/admin/login") ||
    p.includes("sign-in") ||
    p.includes("password") ||
    p.startsWith("/api/push/") ||
    p.startsWith("/api/chat/") ||
    p.startsWith("/api/auth/transactional/")
  ) {
    return "auth_sensitive";
  }

  return "default";
}

export function limitsForTier(tier: ApiRateTier): { limit: number; windowMs: number } | null {
  switch (tier) {
    case "exempt":
      return null;
    case "webhook":
      return { limit: 120, windowMs: 60_000 };
    case "money":
      return { limit: 40, windowMs: 60_000 };
    case "location":
      return { limit: 60, windowMs: 60_000 };
    case "auth_sensitive":
      return { limit: 20, windowMs: 60_000 };
    default:
      return { limit: 120, windowMs: 60_000 };
  }
}
