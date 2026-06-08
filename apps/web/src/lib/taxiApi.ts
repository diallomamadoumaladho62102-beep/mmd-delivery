import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { hasAnyRole, normalizeUserRole, type UserRole } from "@/lib/roles";

const STAFF_ROLES = ["admin", "ops", "support", "finance", "review"] as const;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function taxiJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function getBearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export function parseUuidField(
  body: Record<string, unknown>,
  keys: string[],
  label: string
): string {
  let raw = "";
  for (const key of keys) {
    const value = body[key];
    if (value != null && String(value).trim()) {
      raw = String(value).trim();
      break;
    }
  }

  if (!raw) {
    throw new Error(`Missing ${label}`);
  }

  if (!UUID_RE.test(raw)) {
    throw new Error(`Invalid ${label}`);
  }

  return raw;
}

export function getTaxiRideId(body: Record<string, unknown>): string {
  return parseUuidField(
    body,
    ["taxi_ride_id", "taxiRideId", "ride_id", "rideId"],
    "taxi_ride_id"
  );
}

export function getTaxiOfferId(body: Record<string, unknown>): string {
  return parseUuidField(
    body,
    ["taxi_offer_id", "taxiOfferId", "offer_id", "offerId"],
    "taxi_offer_id"
  );
}

export function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

export type TaxiApiAuthSuccess = {
  ok: true;
  user: User;
  token: string;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
};

export type TaxiApiAuthFailure = {
  ok: false;
  response: NextResponse;
};

export async function requireTaxiApiUser(
  req: NextRequest
): Promise<TaxiApiAuthSuccess | TaxiApiAuthFailure> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, response: taxiJson({ error: "Missing Authorization Bearer token" }, 401) };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const supabaseAdmin = getSupabaseAdminClient();

  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;

  if (error || !user?.id) {
    return { ok: false, response: taxiJson({ error: "Invalid token" }, 401) };
  }

  return { ok: true, user, token, supabaseUser, supabaseAdmin };
}

export async function getProfileRole(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeUserRole(data?.role);
}

export function isStaffRole(role: UserRole): boolean {
  return hasAnyRole(role, STAFF_ROLES);
}

export async function assertClientOwnsTaxiRide(params: {
  supabaseAdmin: SupabaseClient;
  rideId: string;
  userId: string;
  role: UserRole;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isStaffRole(params.role)) {
    return { ok: true };
  }

  const { data, error } = await params.supabaseAdmin
    .from("taxi_rides")
    .select("id, client_user_id")
    .eq("id", params.rideId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message };
  }

  if (!data) {
    return { ok: false, status: 404, error: "Taxi ride not found" };
  }

  if (String(data.client_user_id) !== params.userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true };
}
