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

    const { data: commission, error: commissionError } = await supabaseAdmin
      .from("taxi_commissions")
      .select("driver_paid_out, driver_transfer_id")
      .eq("taxi_ride_id", rideId)
      .maybeSingle();

    if (commissionError) {
      return json({ error: commissionError.message }, 500);
    }

    const payoutAlreadySent =
      commission?.driver_paid_out === true ||
      !!String(commission?.driver_transfer_id ?? "").trim();

    if (payoutAlreadySent) {
      return json({ error: "taxi_refund_not_allowed_after_payout" }, 409);
    }

    const alreadyRefunded =
      !!ride.stripe_refund_id || !!ride.stripe_refunded_at;

    const canRefund =
      ride.payment_status === "paid" &&
      !!ride.stripe_payment_intent_id &&
      !alreadyRefunded;

    const oldStatus = ride.status;
    const canceledAt = nowIso();

    const preRefundPayload: Record<string, unknown> = {
      status: "canceled",
      driver_id: null,
      cancel_reason: adminReason,
      cancelled_by: "admin",
      cancelled_at: canceledAt,
      refund_status: alreadyRefunded
        ? "refunded"
        : canRefund
          ? "refund_processing"
          : ride.payment_status === "paid"
            ? "missing_payment_intent"
            : "not_paid",
    };

    const { data: preUpdated, error: preUpdateError } = await supabaseAdmin
      .from("taxi_rides")
      .update(preRefundPayload)
      .eq("id", rideId)
      .select(
        "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id,payment_status"
      )
      .maybeSingle();

    if (preUpdateError) {
      return json({ error: preUpdateError.message }, 500);
    }

    await supabaseAdmin
      .from("taxi_offers")
      .update({ status: "expired", updated_at: canceledAt })
      .eq("taxi_ride_id", rideId)
      .eq("status", "pending");

    let stripeRefund: { id: string; status: string | null } | null = null;
    let finalRefundStatus = String(preUpdated?.refund_status ?? preRefundPayload.refund_status);

    if (canRefund) {
      try {
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
        finalRefundStatus = "refunded";
      } catch (refundErr: unknown) {
        console.error("[admin taxi cancel-refund] stripe refund failed", {
          rideId,
          message:
            refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
        finalRefundStatus = "refund_failed";
      }
    }

    const finalPayload: Record<string, unknown> = {
      refund_status: finalRefundStatus,
      updated_at: nowIso(),
    };

    if (stripeRefund?.id) {
      finalPayload.stripe_refund_id = stripeRefund.id;
      finalPayload.stripe_refunded_at = nowIso();
      finalPayload.payment_status = "refunded";
    }

    const { data: updated, error: finalUpdateError } = await supabaseAdmin
      .from("taxi_rides")
      .update(finalPayload)
      .eq("id", rideId)
      .select(
        "id,status,refund_status,stripe_refund_id,stripe_refunded_at,driver_id,payment_status"
      )
      .maybeSingle();

    if (finalUpdateError) {
      return json(
        {
          error: "Refund state updated partially; verify Stripe and ride row",
          stripeRefund,
          ride: preUpdated,
        },
        500
      );
    }

    await logTaxiEventServer(supabaseAdmin, {
      rideId,
      eventType: "admin_cancel_refund",
      oldStatus,
      newStatus: "canceled",
      actorId: session.userId,
      triggeredRole: "admin",
      description: adminReason,
      metadata: {
        refunded_now: !!stripeRefund?.id,
        stripe_refund_id: stripeRefund?.id ?? null,
        refund_status: finalRefundStatus,
      },
    });

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "taxi_ride_cancel_refund",
      targetType: "taxi_ride",
      targetId: rideId,
      oldValues: ride as Record<string, unknown>,
      newValues: (updated ?? finalPayload) as Record<string, unknown>,
      metadata: {
        reason: adminReason,
        refunded_now: !!stripeRefund?.id,
        stripe_refund: stripeRefund,
        refund_status: finalRefundStatus,
      },
      request: req,
    });

    if (finalRefundStatus === "refund_failed") {
      return json(
        {
          ok: false,
          error: "refund_failed",
          ride: updated,
          alreadyRefunded,
          refundedNow: false,
          stripeRefund,
          message: "Ride canceled but Stripe refund failed.",
        },
        502
      );
    }

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
