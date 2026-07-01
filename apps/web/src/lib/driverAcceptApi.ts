import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function driverAcceptJson(body: Record<string, unknown>, status = 200) {
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
  label: string,
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

export function getOrderOfferId(body: Record<string, unknown>): string {
  return parseUuidField(body, ["offer_id", "offerId", "order_offer_id"], "offer_id");
}

export function getOrderId(body: Record<string, unknown>): string {
  return parseUuidField(body, ["order_id", "orderId"], "order_id");
}

export function getDeliveryRequestOfferId(body: Record<string, unknown>): string {
  return parseUuidField(
    body,
    ["offer_id", "offerId", "delivery_request_offer_id"],
    "offer_id",
  );
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)",
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
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

export type DriverAcceptAuthSuccess = {
  ok: true;
  user: User;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
};

export type DriverAcceptAuthFailure = {
  ok: false;
  response: NextResponse;
};

export async function requireDriverAcceptUser(
  req: NextRequest,
): Promise<DriverAcceptAuthSuccess | DriverAcceptAuthFailure> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: driverAcceptJson({ error: "Missing Authorization Bearer token" }, 401),
    };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const supabaseAdmin = getSupabaseAdminClient();

  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;

  if (error || !user?.id) {
    return { ok: false, response: driverAcceptJson({ error: "Invalid token" }, 401) };
  }

  return { ok: true, user, supabaseUser, supabaseAdmin };
}

export type RpcRow = { ok?: boolean; message?: string; error?: string; order_id?: string; delivery_request_id?: string };

export function getRpcRow<T extends RpcRow>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T) ?? null;
  }
  return (data as T) ?? null;
}
