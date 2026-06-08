import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertRestaurantOrderEligible } from "@/lib/restaurantOrderAccess";
import { triggerSmartDispatchForOrder } from "@/lib/triggerSmartDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = new Set(["accepted", "prepared", "ready"]);

const NEXT_STATUS: Record<string, string[]> = {
  pending: ["accepted"],
  accepted: ["prepared"],
  prepared: ["ready"],
};

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

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
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
      user.id
    );

    if (restaurantAccess.ok === false) {
      return json(
        { error: restaurantAccess.error },
        restaurantAccess.httpStatus
      );
    }

    const { data: order, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        "id,kind,status,driver_id,restaurant_id,restaurant_user_id,payment_status,restaurant_accept_expires_at,created_at"
      )
      .eq("id", orderId)
      .eq("kind", "food")
      .eq("payment_status", "paid")
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    const ownsOrder =
      sameId(order.restaurant_id, user.id) || sameId(order.restaurant_user_id, user.id);

    if (!ownsOrder) {
      return json({ error: "Forbidden" }, 403);
    }

    const currentStatus = normalize(order.status);
    const allowedNext = NEXT_STATUS[currentStatus] ?? [];

    if (!allowedNext.includes(nextStatus)) {
      return json(
        {
          error: "Invalid status transition",
          status: currentStatus,
          requested: nextStatus,
        },
        409
      );
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: nowIso,
    };

    if (nextStatus === "accepted") {
      updatePayload.restaurant_accepted_at = nowIso;
    }
    if (nextStatus === "prepared") {
      updatePayload.restaurant_prepared_at = nowIso;
    }
    if (nextStatus === "ready") {
      updatePayload.ready_at = nowIso;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .eq("kind", "food")
      .eq("payment_status", "paid")
      .eq("status", order.status)
      .or(`restaurant_user_id.eq.${user.id},restaurant_id.eq.${user.id}`)
      .select("id,status,driver_id")
      .maybeSingle();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    if (!updated) {
      return json({ error: "Order status changed. Please refresh and try again." }, 409);
    }

    const eventType =
      nextStatus === "accepted"
        ? "restaurant_accept"
        : nextStatus === "prepared"
          ? "restaurant_prepared"
          : "restaurant_ready";

    const { error: eventError } = await supabaseAdmin.from("order_events").insert({
      order_id: orderId,
      event_type: eventType,
      old_status: currentStatus,
      new_status: nextStatus,
      note: null,
      actor_id: user.id,
      created_at: nowIso,
      description:
        nextStatus === "accepted"
          ? "Restaurant accepted the order"
          : nextStatus === "prepared"
            ? "Restaurant started preparing the order"
            : "Restaurant marked the order ready",
      triggered_by: user.id,
      triggered_role: "restaurant",
      metadata: {
        source: "api/orders/restaurant/status",
        at: nowIso,
      },
    });

    if (eventError) {
      console.log("order_events insert error:", eventError.message);
    }

    let smartDispatch: Awaited<ReturnType<typeof triggerSmartDispatchForOrder>> | null =
      null;

    if (nextStatus === "ready" && !updated.driver_id) {
      smartDispatch = await triggerSmartDispatchForOrder({
        origin: req.nextUrl.origin,
        orderId,
        wave: 1,
      });
    }

    return json({
      ok: true,
      orderId,
      status: updated.status,
      smartDispatch,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
