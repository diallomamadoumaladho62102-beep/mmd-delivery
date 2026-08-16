import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { findLinkedOrderId } from "@/lib/deliveryRequestDriver";
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
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const token = getBearer(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);
    const { id: requestId } = await ctx.params;
    if (!requestId) return json({ ok: false, error: "Missing id" }, 400);

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

    const { data: row, error } = await admin
      .from("delivery_requests")
      .select("id, status, client_user_id, created_by, driver_id")
      .eq("id", requestId)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "not_found" }, 404);

    const owns =
      sameId(row.client_user_id, userId) || sameId(row.created_by, userId);
    if (!owns) return json({ ok: false, error: "forbidden" }, 403);

    const linkedOrderId = await findLinkedOrderId(admin, requestId);
    if (!linkedOrderId) {
      return json({ ok: true, rating: null, linked_order_id: null });
    }

    const { data: driverRating } = await admin
      .from("driver_ratings")
      .select("id, rating, comment, ratee_driver_id, created_at")
      .eq("order_id", linkedOrderId)
      .eq("rater_user_id", userId)
      .maybeSingle();

    return json({
      ok: true,
      rating: driverRating ?? null,
      linked_order_id: linkedOrderId,
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
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const token = getBearer(req);
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);
    const { id: requestId } = await ctx.params;
    if (!requestId) return json({ ok: false, error: "Missing id" }, 400);

    const body = (await req.json().catch(() => ({}))) as Body;
    const rating = Math.round(Number(body.rating));
    const comment =
      body.comment == null
        ? null
        : String(body.comment).trim().slice(0, 800) || null;

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

    const { data: row, error } = await admin
      .from("delivery_requests")
      .select("id, status, client_user_id, created_by, driver_id")
      .eq("id", requestId)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!row) return json({ ok: false, error: "not_found" }, 404);

    const owns =
      sameId(row.client_user_id, userId) || sameId(row.created_by, userId);
    if (!owns) return json({ ok: false, error: "forbidden" }, 403);

    if (String(row.status ?? "").toLowerCase() !== "delivered") {
      return json({ ok: false, error: "not_delivered" }, 409);
    }

    const driverId = String(row.driver_id ?? "").trim();
    if (!driverId) return json({ ok: false, error: "missing_driver" }, 409);

    const linkedOrderId = await findLinkedOrderId(admin, requestId);
    if (!linkedOrderId) {
      return json({ ok: false, error: "linked_order_missing" }, 409);
    }

    const { data: existing } = await admin
      .from("driver_ratings")
      .select("id, rating")
      .eq("order_id", linkedOrderId)
      .eq("rater_user_id", userId)
      .maybeSingle();
    if (existing?.id) {
      return json(
        { ok: false, error: "rating_already_exists", rating: existing },
        409,
      );
    }

    const result = await upsertDeliveryDriverRating({
      supabaseAdmin: admin,
      orderId: linkedOrderId,
      driverId,
      raterUserId: userId,
      rating,
      comment,
      sourceType: "delivery_request",
      sourceId: requestId,
    });
    if (result.ok === false) {
      return json({ ok: false, error: result.error }, 400);
    }

    const { data: summary } = await admin
      .from("driver_rating_summary")
      .select("driver_id, rating, rating_count")
      .eq("driver_id", driverId)
      .maybeSingle();

    return json({
      ok: true,
      created: result.created,
      rating,
      linked_order_id: linkedOrderId,
      driver_rating_summary: summary ?? null,
    });
  } catch (e: unknown) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}