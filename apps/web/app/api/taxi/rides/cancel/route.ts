import { NextRequest } from "next/server";
import Stripe from "stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { releaseEntityCredit } from "@/lib/loyalty/loyaltyCredit";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  getTaxiRideId,
  normalizeStatus,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

function clientCanCancelStatus(status: string, driverId: unknown) {
  if (driverId) return false;
  return ["draft", "quoted", "pending_payment", "paid", "dispatching"].includes(
    status
  );
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    let rideId = "";

    try {
      rideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const scope = await assertClientOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });

    if (scope.ok === false) {
      return taxiJson({ ok: false, error: scope.error }, scope.status);
    }

    const { data: ride, error: readError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,status,payment_status,driver_id,stripe_payment_intent_id,stripe_refund_id,stripe_refunded_at,refund_status"
      )
      .eq("id", rideId)
      .maybeSingle();

    if (readError) {
      return taxiJson({ ok: false, error: readError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ ok: false, error: "Taxi ride not found" }, 404);
    }

    const status = normalizeStatus(ride.status);

    if (status === "canceled") {
      return taxiJson({
        ok: true,
        cancelled: true,
        alreadyCancelled: true,
        taxi_ride_id: rideId,
      });
    }

    if (status === "completed") {
      return taxiJson({ ok: false, error: "Completed ride cannot be cancelled" }, 400);
    }

    if (!clientCanCancelStatus(status, ride.driver_id)) {
      return taxiJson(
        { ok: false, error: "Ride cannot be cancelled at this stage" },
        400
      );
    }

    const refundPolicy =
      normalizeStatus(ride.payment_status) === "paid" ? "FULL" : "NONE";
    const canceledAt = new Date().toISOString();
    const reason = "client_cancelled_before_driver_assigned";

    const { data: updated, error: updateError } = await auth.supabaseAdmin
      .from("taxi_rides")
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
      .eq("id", rideId)
      .eq("status", ride.status)
      .select("id,status")
      .maybeSingle();

    if (updateError) {
      return taxiJson({ ok: false, error: updateError.message }, 500);
    }

    if (!updated) {
      return taxiJson(
        { ok: false, error: "Ride status changed. Please refresh and try again." },
        409
      );
    }

    // Crédit MMD: free a still-held reservation (no-op once captured; the refund
    // path re-credits captured amounts on paid rides).
    await releaseEntityCredit(auth.supabaseAdmin, "taxi_ride", rideId);

    let stripeRefund: unknown = null;

    if (
      refundPolicy === "FULL" &&
      normalizeStatus(ride.payment_status) === "paid" &&
      !ride.stripe_refund_id &&
      !ride.stripe_refunded_at
    ) {
      const paymentIntentId = String(ride.stripe_payment_intent_id ?? "").trim();
      if (paymentIntentId) {
        try {
          const stripe = getStripe();
          const refund = await stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              reason: "requested_by_customer",
              metadata: {
                module: "taxi",
                taxi_ride_id: rideId,
                cancel_reason: reason,
              },
            },
            { idempotencyKey: `refund_taxi_${rideId}` }
          );

          stripeRefund = { refundId: refund.id, status: refund.status };

          await auth.supabaseAdmin
            .from("taxi_rides")
            .update({
              refund_status: "refunded",
              stripe_refund_id: refund.id,
              stripe_refunded_at: canceledAt,
              payment_status: "refunded",
            })
            .eq("id", rideId);
        } catch (refundErr: unknown) {
          console.log(
            "taxi cancel refund error:",
            refundErr instanceof Error ? refundErr.message : refundErr
          );
          await auth.supabaseAdmin
            .from("taxi_rides")
            .update({ refund_status: "refund_failed" })
            .eq("id", rideId);
        }
      }
    }

    await auth.supabaseAdmin
      .from("taxi_offers")
      .update({ status: "expired", updated_at: canceledAt })
      .eq("taxi_ride_id", rideId)
      .eq("status", "pending");

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "ride_cancelled",
      oldStatus: status,
      newStatus: "canceled",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client cancelled taxi ride",
      metadata: { refund: refundPolicy, stripe_refund: stripeRefund },
    });

    return taxiJson({
      ok: true,
      cancelled: true,
      taxi_ride_id: rideId,
      refund: refundPolicy,
      stripeRefund,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
