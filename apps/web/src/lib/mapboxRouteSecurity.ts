import { NextRequest } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_USER = 60;
const MAX_REQUESTS_PER_IP = 20;

type RateBucket = Map<string, number[]>;

const globalForRateLimit = globalThis as typeof globalThis & {
  __mmdMapboxRateLimit?: { users: RateBucket; ips: RateBucket };
};

function getRateLimitStores(): { users: RateBucket; ips: RateBucket } {
  if (!globalForRateLimit.__mmdMapboxRateLimit) {
    globalForRateLimit.__mmdMapboxRateLimit = {
      users: new Map(),
      ips: new Map(),
    };
  }
  return globalForRateLimit.__mmdMapboxRateLimit;
}

function pruneAndCount(store: RateBucket, key: string, now: number): number {
  const windowStart = now - RATE_WINDOW_MS;
  const existing = store.get(key) ?? [];
  const pruned = existing.filter((ts) => ts >= windowStart);
  pruned.push(now);
  store.set(key, pruned);
  return pruned.length;
}

function isRateLimited(userId: string, ip: string): boolean {
  const now = Date.now();
  const { users, ips } = getRateLimitStores();
  const userCount = pruneAndCount(users, userId, now);
  const ipCount = pruneAndCount(ips, ip, now);
  return (
    userCount > MAX_REQUESTS_PER_USER || ipCount > MAX_REQUESTS_PER_IP
  );
}

function extractBearerToken(req: NextRequest): string {
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function getUserFromBearerToken(token: string): Promise<User | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing Supabase env for mapbox auth");
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user?.id) return null;
  return user;
}

export type MapboxAccessResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

export async function assertMapboxComputeDistanceAccess(
  req: NextRequest
): Promise<MapboxAccessResult> {
  const token = extractBearerToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing Authorization Bearer token",
    };
  }

  let user: User | null = null;

  try {
    user = await getUserFromBearerToken(token);
  } catch (e) {
    console.error("[mapbox/compute-distance] auth env error", e);
    return { ok: false, status: 500, error: "Server misconfigured" };
  }

  if (!user) {
    return { ok: false, status: 401, error: "Invalid token" };
  }

  const ip = getClientIp(req);

  if (isRateLimited(user.id, ip)) {
    return { ok: false, status: 429, error: "Too many requests" };
  }

  return { ok: true, userId: user.id };
}
