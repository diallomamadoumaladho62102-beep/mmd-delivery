import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelRole = "client" | "driver" | "restaurant";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeKind(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeRole(value: unknown): CancelRole {
  const role = String(value ?? "client").trim().toLowerCase();

  if (role === "driver") return "driver";
  if (role === "restaurant") return "restaurant";

  return "client";
}

function extractBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

async function safeReadJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function triggerSmartDispatch(req: NextRequest, orderId: string) {
  try {
    const url = new URL("/api/dispatch/smart", req.nextUrl.origin);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, order_id: orderId }),
      cache: "no-store",
    });

    const out = await res.json().catch(() => null);

    return {
      ok: res.ok,
      status: res.status,
      result: out,
    };
  } catch (e: any) {
    console.log("Smart dispatch error:", e?.message ?? e);
    return {
      ok: false,
      error: e?.message ?? "Smart dispatch failed",
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await safeReadJson(req);
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();
    const role = normalizeRole(body.role);

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } =
      await supabaseUser.auth.getUser();

    const user = userData?.user;

    if (userError || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        kind,
        status,
        driver_id,
        restaurant_id,
        client_id,
        client_user_id,
        created_by,
        user_id
      `
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
    const kind = normalizeKind(order.kind);

    if (status === "canceled") {
      return json({
        ok: true,
        cancelled: true,
        alreadyCancelled: true,
        status,
      });
    }

    if (status === "delivered") {
      return json({ error: "Delivered order cannot be cancelled", status }, 400);
    }

    // CLIENT CANCEL
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

        return json({
          ok: true,
          cancelled: true,
          by: "client",
          refund: "FULL",
        });
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

        return json({
          ok: true,
          cancelled: true,
          by: "client",
          refund: "NONE",
        });
      }

      return json(
        { error: "Client cannot cancel this order at this stage", status },
        400
      );
    }

    // RESTAURANT CANCEL / REFUSE
    if (role === "restaurant") {
      if (!sameId(order.restaurant_id, user.id)) {
        return json({ error: "Forbidden: not order restaurant" }, 403);
      }

      if (
        status === "pending" ||
        status === "accepted" ||
        status === "prepared"
      ) {
        const reason =
          status === "pending"
            ? "restaurant_refused_order"
            : "restaurant_cancelled_before_ready";

        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: "canceled",
            driver_id: null,
            cancel_reason: reason,
            cancelled_by: "restaurant",
            cancelled_at: new Date().toISOString(),
            refund_status: "full_refund_required",
          })
          .eq("id", orderId)
          .eq("restaurant_id", user.id);

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        return json({
          ok: true,
          cancelled: true,
          by: "restaurant",
          refund: "FULL",
          message:
            status === "pending"
              ? "Order refused by restaurant. Full refund required."
              : "Order cancelled by restaurant. Full refund required.",
        });
      }

      return json(
        {
          error:
            "Restaurant cannot cancel this order after it is ready, dispatched, or delivered",
          status,
        },
        400
      );
    }

    // DRIVER CANCEL
    if (role === "driver") {
      if (!sameId(order.driver_id, user.id)) {
        return json({ error: "Forbidden: not assigned driver" }, 403);
      }

      if (status === "accepted" || status === "ready") {
        const nextStatus =
          kind === "pickup_dropoff"
            ? "pending"
            : kind === "food"
              ? "ready"
              : status === "ready"
                ? "ready"
                : "pending";

        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: nextStatus,
            driver_id: null,
            cancel_reason: "driver_cancelled_before_pickup",
            cancelled_by: "driver",
            cancelled_at: new Date().toISOString(),
            refund_status: null,
          })
          .eq("id", orderId)
          .eq("driver_id", user.id);

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        const smartDispatch = await triggerSmartDispatch(req, orderId);

        return json({
          ok: true,
          cancelled: true,
          by: "driver",
          reassigned: true,
          status: nextStatus,
          smartDispatch,
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
    console.log("Cancel order route error:", e?.message ?? e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}