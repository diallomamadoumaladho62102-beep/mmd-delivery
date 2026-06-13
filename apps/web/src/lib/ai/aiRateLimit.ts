import type { NextRequest } from "next/server";
import {
  getAiRateLimitMaxPerUser,
  getAiRateLimitWindowMs,
} from "@/lib/ai/aiConfig";

type RateBucket = Map<string, number[]>;

const globalForAiRateLimit = globalThis as typeof globalThis & {
  __mmdAiRateLimit?: { users: RateBucket };
};

function getStore(): RateBucket {
  if (!globalForAiRateLimit.__mmdAiRateLimit) {
    globalForAiRateLimit.__mmdAiRateLimit = { users: new Map() };
  }
  return globalForAiRateLimit.__mmdAiRateLimit.users;
}

function pruneAndCount(store: RateBucket, key: string, now: number, windowMs: number): number {
  const windowStart = now - windowMs;
  const existing = store.get(key) ?? [];
  const pruned = existing.filter((ts) => ts >= windowStart);
  pruned.push(now);
  store.set(key, pruned);
  return pruned.length;
}

export function checkAiRateLimit(userId: string): { allowed: true } | { allowed: false; retryAfter: number } {
  const windowMs = getAiRateLimitWindowMs();
  const max = getAiRateLimitMaxPerUser();
  const now = Date.now();
  const count = pruneAndCount(getStore(), userId, now, windowMs);

  if (count <= max) {
    return { allowed: true };
  }

  const store = getStore();
  const timestamps = store.get(userId) ?? [];
  const oldestInWindow = timestamps[0] ?? now;
  const retryAfter = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
  return { allowed: false, retryAfter };
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
