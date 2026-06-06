import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  AdminAccessError,
  assertCanManageOrders,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function getStripe() {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await assertCanManageOrders(req);

    const body = await req.json().catch(() => ({}));
    const orderId = String(
      (body as { orderId?: string; order_id?: string }).orderId ??
        (body as { order_id?: string }).order_id ??
        ""
    ).trim();
    const adminReason = String(
      (body as { reason?: string }).reason ?? "admin_cancel_refund"
    ).trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabaseAdmin = buildSupabaseAdminClient();

    const { data: order, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        `id, status, payment_status, refund_status,
         stripe_payment_intent_id, stripe_refund_id, stripe_refunded_at,
         driver_id, cancel_reason, cancelled_by, cancelled_at`
      )
      .eq("id", orderId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    let stripeRefund: { id: string; status: string | null } | null = null;

    const alreadyRefunded =
      !!order.stripe_refund_id || !!order.stripe_refunded_at;

    const canRefund =
      order.payment_status === "paid" &&
      !!order.stripe_payment_intent_id &&
      !alreadyRefunded;

    if (canRefund) {
      const stripe = getStripe();

      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id,
          reason: "requested_by_customer",
          metadata: {
            order_id: orderId,
            admin_id: session.userId,
            reason: adminReason,
          },
        },
        {
          idempotencyKey: `admin_cancel_refund_${orderId}`,
        }
      );

      stripeRefund = {
        id: refund.id,
        status: refund.status,
      };
    }

    const updatePayload: Record<string, unknown> = {
      status: "canceled",
      driver_id: null,
      cancel_reason: adminReason,
      cancelled_by: "admin",
      cancelled_at: nowIso(),
      refund_status: canRefund
        ? "refunded"
        : alreadyRefunded
          ? "refunded"
          : order.payment_status === "paid"
            ? "missing_payment_intent"
            : "not_paid",
    };

    if (stripeRefund?.id) {
      updatePayload.stripe_refund_id = stripeRefund.id;
      updatePayload.stripe_refunded_at = nowIso();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .select(
        "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id"
      )
      .maybeSingle();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "order_cancel_refund",
      targetType: "order",
      targetId: orderId,
      oldValues: order as Record<string, unknown>,
      newValues: (updated ?? updatePayload) as Record<string, unknown>,
      metadata: {
        reason: adminReason,
        refunded_now: !!stripeRefund?.id,
        stripe_refund: stripeRefund,
      },
      request: req,
    });

    return json({
      ok: true,
      order: updated,
      alreadyRefunded,
      refundedNow: !!stripeRefund?.id,
      stripeRefund,
      message: "Admin cancel/refund completed.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    console.log("Admin cancel refund error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
