import type { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type RestaurantAuthContext = {
  restaurantUserId: string;
  admin: SupabaseClient;
};

export type RestaurantAuthResult =
  | { ok: true; ctx: RestaurantAuthContext }
  | { ok: false; message: string; status: number };

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export async function requireRestaurantApiUser(
  req: NextRequest
): Promise<RestaurantAuthResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, message: "Missing bearer token", status: 401 };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return {
      ok: false,
      message: "Missing Supabase environment variables",
      status: 500,
    };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return { ok: false, message: "Invalid session", status: 401 };
  }

  const restaurantUserId = authData.user.id;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", restaurantUserId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      message: profileError.message || "Failed to verify profile",
      status: 500,
    };
  }

  const role = String(profileRow?.role ?? "")
    .trim()
    .toLowerCase();

  if (role !== "restaurant") {
    return { ok: false, message: "Forbidden: restaurant role required", status: 403 };
  }

  return { ok: true, ctx: { restaurantUserId, admin } };
}
