import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertRestaurantOrderEligible } from "@/lib/restaurantOrderAccess";
import { transitionRestaurantOrderStatus } from "@/lib/restaurantOrderStatusService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["accepted", "prepared", "ready"]);

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();
    const nextStatus = normalize(body.status);

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    if (!ALLOWED_STATUSES.has(nextStatus)) {
      return json({ error: "Invalid status" }, 400);
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    const user = userData?.user;

    if (userError || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return json({ error: profileError.message }, 500);
    }

    if (normalize(profile?.role) !== "restaurant") {
      return json({ error: "Forbidden" }, 403);
    }

    const restaurantAccess = await assertRestaurantOrderEligible(
      supabaseAdmin,
      user.id,
    );

    if (restaurantAccess.ok === false) {
      return json({ error: restaurantAccess.error }, restaurantAccess.httpStatus);
    }

    const result = await transitionRestaurantOrderStatus({
      supabaseAdmin,
      orderId,
      nextStatus: nextStatus as "accepted" | "prepared" | "ready",
      actorUserId: user.id,
      actorRole: "restaurant",
      source: "api/orders/restaurant/status",
      dispatchOrigin: req.nextUrl.origin,
    });

    if (result.ok === false) {
      return json(
        {
          error: result.error,
          ...(result.details ?? {}),
        },
        result.httpStatus ?? 500,
      );
    }

    return json({
      ok: true,
      orderId,
      status: result.status,
      smartDispatch: result.smartDispatch,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
