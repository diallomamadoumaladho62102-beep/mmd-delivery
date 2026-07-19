import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  findLinkedOrderId,
  getDeliveryRequestId,
} from "@/lib/deliveryRequestDriver";
import { notifyClientDeliveryRequestCancelled } from "@/lib/clientPushNotifications";
import { gateDeliveryRequestPlatformFeature } from "@/lib/platformRouteGuards";
import { releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelRefund = "FULL" | "NONE";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
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

function sameId(a: unknown, b: string) {
  return String(a ?? "").trim() === b;
}

function nowIso() {
  return new Date().toISOString();
}

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function isClientDeliveryRequestOwner(row: Record<string, unknown>, userId: string) {
  return (
    sameId(row.client_user_id, userId) ||
    sameId(row.created_by, userId)
  );
}

function clientCanCancelStatus(status: string) {
  return status === "pending" || status === "accepted";
}

async function refundStripePayment(params: {
  row: Record<string, unknown>;
  supabaseAdmin: SupabaseClient;
  entityId: string;
  entityType: "delivery_request" | "order";
  table: "delivery_requests" | "orders";
  reason: string;
}) {
  const { row, supabaseAdmin, entityId, entityType, table, reason } = params;

  if (row.stripe_refunded_at || row.stripe_refund_id) {
    return {
      refunded: false,
      alreadyRefunded: true,
      refundId: row.stripe_refund_id ?? null,
    };
  }

  const paymentIntentId = String(row.stripe_payment_intent_id ?? "").trim();

  if (!paymentIntentId) {
    await supabaseAdmin
      .from(table)
      .update({ refund_status: "missing_payment_intent" })
      .eq("id", entityId);

    return { refunded: false, missingPaymentIntent: true };
  }

  try {
    const stripe = getStripe();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: "requested_by_customer",
        metadata: {
          [`${entityType}_id`]: entityId,
          cancel_reason: reason,
        },
      },
      {
        idempotencyKey: `refund_${entityType}_${entityId}`,
      }
    );

    await supabaseAdmin
      .from(table)
      .update({
        refund_status: "refunded",
        stripe_refund_id: refund.id,
        stripe_refunded_at: nowIso(),
      })
      .eq("id", entityId);

    return {
      refunded: true,
      refundId: refund.id,
      status: refund.status,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("Stripe refund error (delivery request):", message);

    await supabaseAdmin
      .from(table)
      .update({ refund_status: "refund_failed" })
      .eq("id", entityId);

    throw new Error(message || "Stripe refund failed");
  }
}

async function insertOrderEvent(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  oldStatus: string;
  reason: string;
  userId: string;
  refund: CancelRefund;
  stripeRefund: unknown;
}) {
  const canceledAt = nowIso();
  const { error } = await params.supabaseAdmin.from("order_events").insert({
    order_id: params.orderId,
    event_type: "client_cancel",
    old_status: params.oldStatus,
    new_status: "canceled",
    note: params.reason,
    actor_id: params.userId,
    created_at: canceledAt,
    description: "Client cancelled the delivery request",
    triggered_by: params.userId,
    triggered_role: "client",
    metadata: {
      source: "api/delivery-requests/cancel",
      refund: params.refund,
      stripe_refund: params.stripeRefund,
      at: canceledAt,
    },
  });

  if (error) {
    console.log("order_events insert error (delivery request cancel):", error.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    let requestId = "";

    try {
      requestId = getDeliveryRequestId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return json({ error: message }, 400);
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

    const { data: requestRow, error: readError } = await supabaseAdmin
      .from("delivery_requests")
      .select(
        `
        id,
        status,
        payment_status,
        client_user_id,
        created_by,
        driver_id,
        stripe_session_id,
        stripe_payment_intent_id,
        stripe_refund_id,
        stripe_refunded_at,
        refund_status,
        currency,
        pickup_lat,
        pickup_lng
      `
      )
      .eq("id", requestId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!requestRow) {
      return json({ error: "Delivery request not found" }, 404);
    }

    if (!isClientDeliveryRequestOwner(requestRow as Record<string, unknown>, user.id)) {
      return json({ error: "Forbidden: not request owner" }, 403);
    }

    const platformGate = await gateDeliveryRequestPlatformFeature(
      supabaseAdmin,
      requestRow,
      "active"
    );
    if (platformGate.ok === false) {
      return json(platformGate.body, platformGate.status);
    }

    const status = normalizeStatus(requestRow.status);

    if (status === "canceled") {
      return json({
        ok: true,
        cancelled: true,
        alreadyCancelled: true,
        status,
        refund_status: requestRow.refund_status ?? null,
      });
    }

    if (status === "delivered") {
      return json({ error: "Delivered request cannot be cancelled", status }, 400);
    }

    if (!clientCanCancelStatus(status)) {
      return json(
        {
          error: "Client cannot cancel this delivery request at this stage",
          status,
        },
        400
      );
    }

    const refundPolicy: CancelRefund = status === "pending" ? "FULL" : "NONE";
    const reason =
      status === "pending"
        ? "client_cancelled_before_driver_assigned"
        : "client_cancelled_after_driver_assigned";
    const canceledAt = nowIso();

    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from("delivery_requests")
      .update({
        status: "canceled",
        driver_id: null,
        cancel_reason: reason,
        cancelled_by: "client",
        cancelled_at: canceledAt,
        refund_status:
          refundPolicy === "FULL" ? "full_refund_required" : "no_refund",
        updated_at: canceledAt,
      })
      .eq("id", requestId)
      .eq("status", requestRow.status)
      .select("id,status")
      .maybeSingle();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    if (updatedRequest) {
      // Crédit MMD: free a still-held reservation (no-op once captured).
      await releaseEntityCredit(supabaseAdmin, "delivery_request", requestId);
      try {
        const { releaseEntityMarketing } = await import(
          "@/lib/marketing/marketingCheckoutLifecycle"
        );
        await releaseEntityMarketing(
          supabaseAdmin,
          "delivery",
          requestId,
          "delivery_request_cancelled"
        );
      } catch {
        /* fail-open */
      }
    }

    if (!updatedRequest) {
      return json(
        { error: "Request status changed. Please refresh and try again." },
        409
      );
    }

    let stripeRefund: unknown = null;

    if (refundPolicy === "FULL" && normalizeStatus(requestRow.payment_status) === "paid") {
      stripeRefund = await refundStripePayment({
        row: requestRow as Record<string, unknown>,
        supabaseAdmin,
        entityId: requestId,
        entityType: "delivery_request",
        table: "delivery_requests",
        reason,
      });
    }

    const linkedOrderId = await findLinkedOrderId(supabaseAdmin, requestId);

    if (linkedOrderId) {
      const { data: linkedOrder } = await supabaseAdmin
        .from("orders")
        .select(
          "id, status, payment_status, stripe_payment_intent_id, stripe_refund_id, stripe_refunded_at"
        )
        .eq("id", linkedOrderId)
        .maybeSingle();

      if (linkedOrder) {
        const linkedStatus = normalizeStatus(linkedOrder.status);

        if (linkedStatus !== "canceled" && linkedStatus !== "delivered") {
          await supabaseAdmin
            .from("orders")
            .update({
              status: "canceled",
              driver_id: null,
              cancel_reason: reason,
              cancelled_by: "client",
              cancelled_at: canceledAt,
              refund_status:
                refundPolicy === "FULL" ? "full_refund_required" : "no_refund",
              updated_at: canceledAt,
            })
            .eq("id", linkedOrderId);

          if (
            refundPolicy === "FULL" &&
            normalizeStatus(linkedOrder.payment_status) === "paid" &&
            !linkedOrder.stripe_refund_id &&
            !linkedOrder.stripe_refunded_at
          ) {
            try {
              await refundStripePayment({
                row: linkedOrder as Record<string, unknown>,
                supabaseAdmin,
                entityId: linkedOrderId,
                entityType: "order",
                table: "orders",
                reason,
              });
            } catch (refundErr: unknown) {
              console.log(
                "Linked order refund error (delivery request cancel):",
                refundErr instanceof Error ? refundErr.message : refundErr
              );
            }
          }

          await insertOrderEvent({
            supabaseAdmin,
            orderId: linkedOrderId,
            oldStatus: linkedStatus,
            reason,
            userId: user.id,
            refund: refundPolicy,
            stripeRefund,
          });
        }
      }
    }

    try {
      await notifyClientDeliveryRequestCancelled({
        supabaseAdmin,
        userIds: [requestRow.client_user_id, requestRow.created_by, user.id],
        deliveryRequestId: requestId,
        refund: refundPolicy,
      });
    } catch (notifyErr: unknown) {
      console.log(
        "delivery request cancel push error:",
        notifyErr instanceof Error ? notifyErr.message : notifyErr
      );
    }

    return json({
      ok: true,
      cancelled: true,
      by: "client",
      refund: refundPolicy,
      status: "canceled",
      delivery_request_id: requestId,
      linked_order_id: linkedOrderId,
      stripeRefund,
      message:
        refundPolicy === "FULL"
          ? "Delivery request cancelled. Full refund processed when payment was captured."
          : "Delivery request cancelled. No refund at this stage.",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    console.log("Cancel delivery request route error:", message);
    return json({ error: message }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
