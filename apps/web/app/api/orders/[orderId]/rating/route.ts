import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { upsertDeliveryDriverRating } from "@/lib/deliveryDriverRating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

type Body = {
  rating?: number;
  comment?: string | null;
  tip_cents?: number;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  try {
    const token = getBearer(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);
    const { orderId } = await ctx.params;
    if (!orderId) return json({ ok: false, error: "Missing order id" }, 400);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const userSb = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userSb.auth.getUser();
    if (userErr || !userData.user?.id) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(
        "id, status, client_id, client_user_id, created_by, user_id, driver_id",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return json({ ok: false, error: orderErr.message }, 500);
    if (!order) return json({ ok: false, error: "order_not_found" }, 404);

    const owns =
      sameId(order.client_id, userId) ||
      sameId(order.client_user_id, userId) ||
      sameId(order.created_by, userId) ||
      sameId(order.user_id, userId);
    if (!owns) return json({ ok: false, error: "forbidden" }, 403);

    const { data: orderRating } = await admin
      .from("order_ratings")
      .select("id, rating, comment, created_at, updated_at")
      .eq("order_id", orderId)
      .eq("rater_id", userId)
      .maybeSingle();

    const { data: driverRating } = await admin
      .from("driver_ratings")
      .select("id, rating, comment, ratee_driver_id, created_at")
      .eq("order_id", orderId)
      .eq("rater_user_id", userId)
      .maybeSingle();

    return json({
      ok: true,
      order_rating: orderRating ?? null,
      driver_rating: driverRating ?? null,
    });
  } catch (e: unknown) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> },
) {
  try {
    const token = getBearer(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);
    const { orderId } = await ctx.params;
    if (!orderId) return json({ ok: false, error: "Missing order id" }, 400);

    const body = (await req.json().catch(() => ({}))) as Body;
    const rating = Math.round(Number(body.rating));
    const comment =
      body.comment == null
        ? null
        : String(body.comment).trim().slice(0, 800) || null;
    const tipCents = Math.max(0, Math.round(Number(body.tip_cents ?? 0)));

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return json({ ok: false, error: "rating_must_be_1_to_5" }, 400);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const userSb = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userSb.auth.getUser();
    if (userErr || !userData.user?.id) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select(
        "id, status, tip_cents, client_id, client_user_id, created_by, user_id, driver_id, external_ref_type, external_ref_id",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr) return json({ ok: false, error: orderErr.message }, 500);
    if (!order) return json({ ok: false, error: "order_not_found" }, 404);

    const owns =
      sameId(order.client_id, userId) ||
      sameId(order.client_user_id, userId) ||
      sameId(order.created_by, userId) ||
      sameId(order.user_id, userId);
    if (!owns) return json({ ok: false, error: "forbidden" }, 403);

    if (String(order.status ?? "").toLowerCase() !== "delivered") {
      return json({ ok: false, error: "order_not_delivered" }, 409);
    }

    const { data: existingOrderRating } = await admin
      .from("order_ratings")
      .select("id, rating")
      .eq("order_id", orderId)
      .eq("rater_id", userId)
      .maybeSingle();

    if (existingOrderRating?.id) {
      // Still ensure driver_ratings exists for older order_ratings-only reviews.
      const driverId = String(order.driver_id ?? "").trim();
      if (driverId) {
        await upsertDeliveryDriverRating({
          supabaseAdmin: admin,
          orderId,
          driverId,
          raterUserId: userId,
          rating: Number(existingOrderRating.rating) || rating,
          comment,
          sourceType:
            String(order.external_ref_type ?? "").toLowerCase() ===
            "delivery_request"
              ? "delivery_request"
              : "food_order",
          sourceId: order.external_ref_id ?? orderId,
        });
      }
      return json(
        {
          ok: false,
          error: "rating_already_exists",
          order_rating: existingOrderRating,
        },
        409,
      );
    }

    const { error: orderRatingErr } = await admin.from("order_ratings").insert({
      order_id: orderId,
      rater_id: userId,
      rating,
      comment,
    });
    if (orderRatingErr) {
      if (String(orderRatingErr.code ?? "") === "23505") {
        return json({ ok: false, error: "rating_already_exists" }, 409);
      }
      return json({ ok: false, error: orderRatingErr.message }, 500);
    }

    const driverId = String(order.driver_id ?? "").trim();
    let driverRatingResult: unknown = null;
    if (driverId) {
      driverRatingResult = await upsertDeliveryDriverRating({
        supabaseAdmin: admin,
        orderId,
        driverId,
        raterUserId: userId,
        rating,
        comment,
        sourceType:
          String(order.external_ref_type ?? "").toLowerCase() ===
          "delivery_request"
            ? "delivery_request"
            : "food_order",
        sourceId: order.external_ref_id ?? orderId,
      });
    }

    let tipApplied = Number(order.tip_cents ?? 0) || 0;
    if (tipCents > 0 && tipApplied === 0) {
      const { error: tipErr } = await admin
        .from("orders")
        .update({ tip_cents: tipCents })
        .eq("id", orderId)
        .eq("tip_cents", 0);
      if (!tipErr) tipApplied = tipCents;
      else tipApplied = Number(order.tip_cents ?? 0) || 0;
    }

    const { data: summary } = driverId
      ? await admin
          .from("driver_rating_summary")
          .select("driver_id, rating, rating_count")
          .eq("driver_id", driverId)
          .maybeSingle()
      : { data: null };

    return json({
      ok: true,
      created: true,
      rating,
      tip_cents: tipApplied,
      driver_rating: driverRatingResult,
      driver_rating_summary: summary ?? null,
    });
  } catch (e: unknown) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}