import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelRole = "client" | "driver";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRole(value: unknown): CancelRole {
  return String(value ?? "client").trim().toLowerCase() === "driver"
    ? "driver"
    : "client";
}

function extractBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await req.json();
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();
    const role = normalizeRole(body.role);

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: userData, error: userError } =
      await supabaseUser.auth.getUser();

    const user = userData?.user;

    if (userError || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: order, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        "id,status,driver_id,client_id,client_user_id,created_by,user_id"
      )
      .eq("id", orderId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    const status = normalizeStatus(order.status);

    if (role === "client") {
      const isOwner =
        sameId(order.client_id, user.id) ||
        sameId(order.client_user_id, user.id) ||
        sameId(order.created_by, user.id) ||
        sameId(order.user_id, user.id);

      if (!isOwner) {
        return json({ error: "Forbidden: not order owner" }, 403);
      }

      if (status === "pending") {
        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: "canceled",
            cancel_reason: "client_cancelled_before_restaurant_accept",
            cancelled_by: "client",
            cancelled_at: new Date().toISOString(),
            refund_status: "full_refund_required",
          })
          .eq("id", orderId);

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        return json({ ok: true, cancelled: true, by: "client", refund: "FULL" });
      }

      if (status === "accepted") {
        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: "canceled",
            cancel_reason: "client_cancelled_after_restaurant_accept",
            cancelled_by: "client",
            cancelled_at: new Date().toISOString(),
            refund_status: "no_refund",
          })
          .eq("id", orderId);

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        return json({ ok: true, cancelled: true, by: "client", refund: "NONE" });
      }

      return json(
        { error: "Client cannot cancel this order at this stage", status },
        400
      );
    }

    if (role === "driver") {
      if (!sameId(order.driver_id, user.id)) {
        return json({ error: "Forbidden: not assigned driver" }, 403);
      }

      if (status === "accepted" || status === "ready") {
        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            driver_id: null,
            cancel_reason: "driver_cancelled_before_pickup",
            cancelled_by: "driver",
            cancelled_at: new Date().toISOString(),
            refund_status: null,
          })
          .eq("id", orderId);

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        return json({
          ok: true,
          cancelled: true,
          by: "driver",
          reassigned: true,
          message: "Driver removed. Order is available for another driver.",
        });
      }

      return json(
        { error: "Driver cannot cancel this order at this stage", status },
        400
      );
    }

    return json({ error: "Invalid role" }, 400);
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}