import { NextRequest } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";

const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_USER = 120;
const MAX_REQUESTS_PER_IP = 120;

function isRateLimited(userId: string, ip: string): boolean {
  const user = checkRateLimit({
    namespace: "mapbox:user",
    key: userId,
    limit: MAX_REQUESTS_PER_USER,
    windowMs: RATE_WINDOW_MS,
  });
  const ipLimit = checkRateLimit({
    namespace: "mapbox:ip",
    key: ip,
    limit: MAX_REQUESTS_PER_IP,
    windowMs: RATE_WINDOW_MS,
  });
  return user.limited || ipLimit.limited;
}

function extractBearerToken(req: NextRequest): string {
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
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

  const ip = getRequestClientIp(req.headers);

  if (isRateLimited(user.id, ip)) {
    return { ok: false, status: 429, error: "Too many requests" };
  }

  return { ok: true, userId: user.id };
}
