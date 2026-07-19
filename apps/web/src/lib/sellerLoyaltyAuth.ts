import type { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SellerAuthContext = {
  sellerUserId: string;
  sellerId: string;
  admin: SupabaseClient;
};

export type SellerAuthResult =
  | { ok: true; ctx: SellerAuthContext }
  | { ok: false; message: string; status: number };

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

// Marketplace sellers are identified by a row in public.sellers (unique user_id),
// not by profiles.role. This mirrors requireRestaurantApiUser but resolves the
// seller ownership through the sellers table.
export async function requireSellerApiUser(
  req: NextRequest
): Promise<SellerAuthResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, message: "Missing bearer token", status: 401 };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return { ok: false, message: "Missing Supabase environment variables", status: 500 };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return { ok: false, message: "Invalid session", status: 401 };
  }

  const sellerUserId = authData.user.id;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sellerRow, error: sellerError } = await admin
    .from("sellers")
    .select("id")
    .eq("user_id", sellerUserId)
    .maybeSingle();

  if (sellerError) {
    return { ok: false, message: sellerError.message || "Failed to verify seller", status: 500 };
  }

  if (!sellerRow?.id) {
    return { ok: false, message: "Forbidden: seller account required", status: 403 };
  }

  return { ok: true, ctx: { sellerUserId, sellerId: String(sellerRow.id), admin } };
}
