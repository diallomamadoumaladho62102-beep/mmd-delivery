import { NextRequest } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { normalizeUserRole, type UserRole } from "@/lib/roles";

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

/** Server-only secret for /api/dispatch/smart (falls back to CRON_SECRET). */
export function getDispatchInternalSecret(): string {
  return (
    process.env.DISPATCH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

export function getBearerToken(req: NextRequest): string {
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function isDispatchInternalRequest(req: NextRequest): boolean {
  const expected = getDispatchInternalSecret();
  if (!expected) return false;

  const headerSecret = (
    req.headers.get("x-dispatch-internal-secret") ||
    req.headers.get("x-cron-secret") ||
    ""
  ).trim();

  if (headerSecret && timingSafeEqual(headerSecret, expected)) return true;

  const bearer = getBearerToken(req);
  return bearer.length > 0 && timingSafeEqual(bearer, expected);
}

export function buildDispatchInternalHeaders(): Record<string, string> {
  const secret = getDispatchInternalSecret();
  if (!secret) return {};

  return {
    "x-dispatch-internal-secret": secret,
  };
}

export type DispatchAccess =
  | { mode: "internal" }
  | { mode: "user"; userId: string; role: UserRole };

export type DispatchAuthFailure = { ok: false; status: number; error: string };

export type DispatchAccessResult =
  | { ok: true; access: DispatchAccess }
  | DispatchAuthFailure;

function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return value;
}

function getSupabaseAnonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return value;
}

async function getUserFromBearerToken(token: string): Promise<User> {
  const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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

  if (error || !user?.id) {
    throw new Error("Invalid token");
  }

  return user;
}

async function getProfileRole(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseService: any,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabaseService
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeUserRole(data?.role);
}

export async function resolveDispatchAccess(
  req: NextRequest,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseService: any
): Promise<DispatchAccessResult> {
  const secret = getDispatchInternalSecret();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "Dispatch auth not configured",
    };
  }

  if (isDispatchInternalRequest(req)) {
    return { ok: true, access: { mode: "internal" } };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  try {
    const user = await getUserFromBearerToken(token);
    const role = await getProfileRole(supabaseService, user.id);

    if (!role) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    return {
      ok: true,
      access: { mode: "user", userId: user.id, role },
    };
  } catch {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

export function assertUserMayDispatchOrder(params: {
  access: DispatchAccess;
  order: {
    restaurant_id?: unknown;
    kind?: unknown;
    payment_status?: unknown;
  };
}): DispatchAuthFailure | { ok: true } {
  if (params.access.mode === "internal") {
    return { ok: true };
  }

  const { userId, role } = params.access;

  if (role === "admin" || role === "ops") {
    return { ok: true };
  }

  if (role === "restaurant") {
    if (!sameId(params.order.restaurant_id, userId)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    if (
      normalize(params.order.kind) === "food" &&
      normalize(params.order.payment_status) !== "paid"
    ) {
      return { ok: false, status: 403, error: "Forbidden" };
    }

    return { ok: true };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}
