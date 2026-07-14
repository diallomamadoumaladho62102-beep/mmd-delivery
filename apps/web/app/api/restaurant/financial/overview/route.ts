import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRestaurantFinancialOverview } from "@/lib/restaurantFinancialOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return jsonError("Missing bearer token", 401);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const serviceRoleKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonError(
        "Missing Supabase environment variables (URL / ANON / SERVICE ROLE)",
        500
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !authData.user) {
      return jsonError("Invalid session", 401);
    }

    const restaurantUserId = authData.user.id;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: profileRow, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", restaurantUserId)
      .maybeSingle();

    if (profileError) {
      return jsonError(profileError.message || "Failed to verify profile", 500);
    }

    const role = String(profileRow?.role ?? "")
      .trim()
      .toLowerCase();

    if (role !== "restaurant") {
      return jsonError("Forbidden: restaurant role required", 403);
    }

    const data = await getRestaurantFinancialOverview({
      supabase: admin,
      restaurantUserId,
    });

    return NextResponse.json(
      { ok: true, data },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error) {
    console.error("restaurant financial overview error:", error);
    return jsonError("Failed to load restaurant financial overview", 500);
  }
}
