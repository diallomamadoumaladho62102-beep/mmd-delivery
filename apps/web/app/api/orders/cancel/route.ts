import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelRole = "client" | "driver" | "restaurant";
type CancelRefund = "FULL" | "NONE" | "NOT_APPLICABLE";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

function getStripe() {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });
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
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

function nowIso() {
  return new Date().toISOString();
}

async function safeReadJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function isTerminalStatus(status: string) {
  return status === "delivered" || status === "canceled";
}

function isClientOrderOwner(order: any, userId: string) {
  return (
    sameId(order.client_id, userId) ||
    sameId(order.client_user_id, userId) ||
    sameId(order.created_by, userId) ||
    sameId(order.user_id, userId)
  );
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

async function refundStripePayment(params: {
  order: any;
  supabaseAdmin: any;
  orderId: string;
  reason: string;
}) {
  const { order, supabaseAdmin, orderId, reason } = params;

  if (order.stripe_refunded_at || order.stripe_refund_id) {
    return {
      refunded: false,
      alreadyRefunded: true,
      refundId: order.stripe_refund_id ?? null,
    };
  }

  const paymentIntentId = String(order.stripe_payment_intent_id ?? "").trim();

  if (!paymentIntentId) {
    await supabaseAdmin
      .from("orders")
      .update({
        refund_status: "missing_payment_intent",
      })
      .eq("id", orderId);

    return {
      refunded: false,
      missingPaymentIntent: true,
    };
  }

  try {
    const stripe = getStripe();

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: "requested_by_customer",
        metadata: {
          order_id: orderId,
          cancel_reason: reason,
        },
      },
      {
        idempotencyKey: `refund_order_${orderId}`,
      }
    );

    await supabaseAdmin
      .from("orders")
      .update({
        refund_status: "refunded",
        stripe_refund_id: refund.id,
        stripe_refunded_at: nowIso(),
      })
      .eq("id", orderId);

    return {
      refunded: true,
      refundId: refund.id,
      status: refund.status,
    };
  } catch (e: any) {
    console.log("Stripe refund error:", e?.message ?? e);

    await supabaseAdmin
      .from("orders")
      .update({
        refund_status: "refund_failed",
      })
      .eq("id", orderId);

    throw new Error(e?.message ?? "Stripe refund failed");
  }
}

function successResponse(params: {
  by: CancelRole;
  refund: CancelRefund;
  status?: string;
  reassigned?: boolean;
  smartDispatch?: unknown;
  stripeRefund?: unknown;
  message?: string;
}) {
  return json({
    ok: true,
    cancelled: true,
    by: params.by,
    refund: params.refund,
    status: params.status,
    reassigned: params.reassigned ?? false,
    smartDispatch: params.smartDispatch,
    stripeRefund: params.stripeRefund,
    message: params.message,
  });
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
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
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
        user_id,
        payment_status,
        refund_status,
        stripe_session_id,
        stripe_payment_intent_id,
        stripe_refund_id,
        stripe_refunded_at
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
        refund_status: order.refund_status ?? null,
        stripe_refund_id: order.stripe_refund_id ?? null,
      });
    }

    if (status === "delivered") {
      return json(
        {
          error: "Delivered order cannot be cancelled",
          status,
        },
        400
      );
    }

    if (isTerminalStatus(status)) {
      return json(
        {
          error: "This order can no longer be cancelled",
          status,
        },
        400
      );
    }

    // CLIENT CANCEL
    if (role === "client") {
      if (!isClientOrderOwner(order, user.id)) {
        return json({ error: "Forbidden: not order owner" }, 403);
      }

      if (status === "pending") {
        const reason = "client_cancelled_before_restaurant_accept";

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: "canceled",
            cancel_reason: reason,
            cancelled_by: "client",
            cancelled_at: nowIso(),
            refund_status: "full_refund_required",
          })
          .eq("id", orderId)
          .eq("status", order.status)
          .select("id,status")
          .maybeSingle();

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        if (!updated) {
          return json(
            {
              error: "Order status changed. Please refresh and try again.",
            },
            409
          );
        }

        const stripeRefund = await refundStripePayment({
          order,
          supabaseAdmin,
          orderId,
          reason,
        });

        return successResponse({
          by: "client",
          refund: "FULL",
          status: "canceled",
          stripeRefund,
          message: "Client cancelled before restaurant acceptance.",
        });
      }

      if (status === "accepted") {
        const { data: updated, error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            status: "canceled",
            cancel_reason: "client_cancelled_after_restaurant_accept",
            cancelled_by: "client",
            cancelled_at: nowIso(),
            refund_status: "no_refund",
          })
          .eq("id", orderId)
          .eq("status", order.status)
          .select("id,status")
          .maybeSingle();

        if (updateError) {
          return json({ error: updateError.message }, 500);
        }

        if (!updated) {
          return json(
            {
              error: "Order status changed. Please refresh and try again.",
            },
            409
          );
        }

        return successResponse({
          by: "client",
          refund: "NONE",
          status: "canceled",
          message: "Client cancelled after restaurant acceptance.",
        });
      }

      return json(
        {
          error: "Client cannot cancel this order at this stage",
          status,
        },
        400
      );
    }

    // RESTAURANT CANCEL / REFUSE
    if (role === "restaurant") {
      if (!sameId(order.restaurant_id, user.id)) {
        return json({ error: "Forbidden: not order restaurant" }, 403);
      }

      const restaurantCanCancel =
        status === "pending" || status === "accepted" || status === "prepared";

      if (!restaurantCanCancel) {
        return json(
          {
            error:
              "Restaurant cannot cancel this order after it is ready, dispatched, or delivered",
            status,
          },
          400
        );
      }

      const reason =
        status === "pending"
          ? "restaurant_refused_order"
          : "restaurant_cancelled_before_ready";

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("orders")
        .update({
          status: "canceled",
          driver_id: null,
          cancel_reason: reason,
          cancelled_by: "restaurant",
          cancelled_at: nowIso(),
          refund_status: "full_refund_required",
        })
        .eq("id", orderId)
        .eq("restaurant_id", user.id)
        .eq("status", order.status)
        .select("id,status")
        .maybeSingle();

      if (updateError) {
        return json({ error: updateError.message }, 500);
      }

      if (!updated) {
        return json(
          {
            error: "Order status changed. Please refresh and try again.",
          },
          409
        );
      }

      const stripeRefund = await refundStripePayment({
        order,
        supabaseAdmin,
        orderId,
        reason,
      });

      return successResponse({
        by: "restaurant",
        refund: "FULL",
        status: "canceled",
        stripeRefund,
        message:
          status === "pending"
            ? "Order refused by restaurant. Full refund processed."
            : "Order cancelled by restaurant. Full refund processed.",
      });
    }

    // DRIVER CANCEL
    if (role === "driver") {
      if (!sameId(order.driver_id, user.id)) {
        return json({ error: "Forbidden: not assigned driver" }, 403);
      }

      const driverCanCancel = status === "accepted" || status === "ready";

      if (!driverCanCancel) {
        return json(
          {
            error: "Driver cannot cancel this order at this stage",
            status,
          },
          400
        );
      }

      const nextStatus =
        kind === "pickup_dropoff"
          ? "pending"
          : kind === "food"
            ? "ready"
            : status === "ready"
              ? "ready"
              : "pending";

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("orders")
        .update({
          status: nextStatus,
          driver_id: null,
          cancel_reason: "driver_cancelled_before_pickup",
          cancelled_by: "driver",
          cancelled_at: nowIso(),
          refund_status: null,
        })
        .eq("id", orderId)
        .eq("driver_id", user.id)
        .eq("status", order.status)
        .select("id,status")
        .maybeSingle();

      if (updateError) {
        return json({ error: updateError.message }, 500);
      }

      if (!updated) {
        return json(
          {
            error: "Order status changed. Please refresh and try again.",
          },
          409
        );
      }

      const smartDispatch = await triggerSmartDispatch(req, orderId);

      return successResponse({
        by: "driver",
        refund: "NOT_APPLICABLE",
        reassigned: true,
        status: nextStatus,
        smartDispatch,
        message: "Driver removed. Order is available for another driver.",
      });
    }

    return json({ error: "Invalid role" }, 400);
  } catch (e: any) {
    console.log("Cancel order route error:", e?.message ?? e);

    return json(
      {
        error: e?.message ?? "Server error",
      },
      500
    );
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}