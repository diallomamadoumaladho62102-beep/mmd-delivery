import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { logTaxiEventServer } from "@/lib/taxiEvents";

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
    const session = await assertCanManageTaxiRides(req);

    const body = await req.json().catch(() => ({}));
    const rideId = String(
      (body as { rideId?: string; taxi_ride_id?: string }).rideId ??
        (body as { taxi_ride_id?: string }).taxi_ride_id ??
        ""
    ).trim();
    const adminReason = String(
      (body as { reason?: string }).reason ?? "admin_cancel_refund"
    ).trim();

    if (!rideId) {
      return json({ error: "Missing rideId" }, 400);
    }

    const supabaseAdmin = buildSupabaseAdminClient();

    const { data: ride, error: readError } = await supabaseAdmin
      .from("taxi_rides")
      .select(
        `id, status, payment_status, refund_status,
         stripe_payment_intent_id, stripe_refund_id, stripe_refunded_at,
         driver_id, cancel_reason, cancelled_by, cancelled_at`
      )
      .eq("id", rideId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!ride) {
      return json({ error: "Taxi ride not found" }, 404);
    }

    let stripeRefund: { id: string; status: string | null } | null = null;

    const alreadyRefunded =
      !!ride.stripe_refund_id || !!ride.stripe_refunded_at;

    const canRefund =
      ride.payment_status === "paid" &&
      !!ride.stripe_payment_intent_id &&
      !alreadyRefunded;

    if (canRefund) {
      const stripe = getStripe();

      const refund = await stripe.refunds.create(
        {
          payment_intent: ride.stripe_payment_intent_id,
          reason: "requested_by_customer",
          metadata: {
            taxi_ride_id: rideId,
            module: "taxi",
            admin_id: session.userId,
            reason: adminReason,
          },
        },
        {
          idempotencyKey: `admin_taxi_cancel_refund_${rideId}`,
        }
      );

      stripeRefund = {
        id: refund.id,
        status: refund.status,
      };
    }

    const oldStatus = ride.status;
    const updatePayload: Record<string, unknown> = {
      status: "cancelled",
      driver_id: null,
      cancel_reason: adminReason,
      cancelled_by: "admin",
      cancelled_at: nowIso(),
      refund_status: canRefund
        ? "refunded"
        : alreadyRefunded
          ? "refunded"
          : ride.payment_status === "paid"
            ? "missing_payment_intent"
            : "not_paid",
    };

    if (stripeRefund?.id) {
      updatePayload.stripe_refund_id = stripeRefund.id;
      updatePayload.stripe_refunded_at = nowIso();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("taxi_rides")
      .update(updatePayload)
      .eq("id", rideId)
      .select(
        "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id"
      )
      .maybeSingle();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    await logTaxiEventServer(supabaseAdmin, {
      rideId,
      eventType: "admin_cancel_refund",
      oldStatus,
      newStatus: "cancelled",
      actorId: session.userId,
      triggeredRole: "admin",
      description: adminReason,
      metadata: {
        refunded_now: !!stripeRefund?.id,
        stripe_refund_id: stripeRefund?.id ?? null,
      },
    });

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "taxi_ride_cancel_refund",
      targetType: "taxi_ride",
      targetId: rideId,
      oldValues: ride as Record<string, unknown>,
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
      ride: updated,
      alreadyRefunded,
      refundedNow: !!stripeRefund?.id,
      stripeRefund,
      message: "Admin taxi cancel/refund completed.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    console.log("Admin taxi cancel refund error:", e);
    return json(
      { error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
