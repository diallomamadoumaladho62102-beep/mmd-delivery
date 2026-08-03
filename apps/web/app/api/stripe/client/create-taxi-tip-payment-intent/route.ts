import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { requireTaxiApiUser, taxiJson, normalizeStatus } from "@/lib/taxiApi";
import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a Stripe PaymentIntent for a taxi ride tip (100% to driver via SCT).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const taxiRideId = String(
      body.taxi_ride_id ?? body.taxiRideId ?? body.ride_id ?? ""
    ).trim();
    const tipCents = Math.max(0, Math.round(Number(body.tip_cents ?? body.amount_cents ?? 0)));
    const minTipCents = getPricingBusinessDefault("taxi_tip_min_cents");

    if (!taxiRideId) {
      return taxiJson({ ok: false, error: "taxi_ride_id_required" }, 400);
    }
    if (tipCents < minTipCents) {
      return taxiJson({ ok: false, error: "min_tip_50_cents" }, 400);
    }

    const { data: ride, error: rideErr } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,client_user_id,driver_id,status,payment_status,currency,tip_cents,tip_paid_out,tip_payment_intent_id,tip_transfer_id"
      )
      .eq("id", taxiRideId)
      .maybeSingle();

    if (rideErr) return taxiJson({ ok: false, error: rideErr.message }, 500);
    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);
    if (String(ride.client_user_id) !== auth.user.id) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }
    if (normalizeStatus(ride.status) !== "completed") {
      return taxiJson({ ok: false, error: "ride_not_completed" }, 400);
    }
    if (normalizeStatus(ride.payment_status) !== "paid") {
      return taxiJson({ ok: false, error: "ride_not_paid" }, 400);
    }
    if (!ride.driver_id) {
      return taxiJson({ ok: false, error: "driver_not_assigned" }, 400);
    }
    if (ride.tip_paid_out || ride.tip_transfer_id) {
      return taxiJson({ ok: false, error: "tip_already_transferred" }, 409);
    }

    const currency = String(ride.currency ?? "USD").toLowerCase();
    const existingPiId = String(ride.tip_payment_intent_id ?? "").trim();
    if (existingPiId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingPiId);
        const st = String(existing.status ?? "").toLowerCase();
        if (st === "succeeded") {
          return taxiJson({ ok: false, error: "tip_payment_already_succeeded" }, 409);
        }
        if (
          (st === "requires_payment_method" || st === "requires_action") &&
          Number(existing.amount) === tipCents
        ) {
          return taxiJson({
            ok: true,
            client_secret: existing.client_secret,
            payment_intent_id: existing.id,
            amount_cents: tipCents,
            currency,
            reused: true,
          });
        }
      } catch {
        /* create new */
      }
    }

    await auth.supabaseAdmin
      .from("taxi_rides")
      .update({ tip_cents: tipCents, updated_at: new Date().toISOString() })
      .eq("id", taxiRideId);

    const pi = await stripe.paymentIntents.create(
      {
        amount: tipCents,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: {
          schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
          kind: "taxi_driver_tip",
          service_type: "taxi",
          taxi_ride_id: taxiRideId,
          user_id: auth.user.id,
          tip_cents: String(tipCents),
        },
      },
      { idempotencyKey: `taxi_tip_pi_${taxiRideId}_${tipCents}` }
    );

    await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        tip_payment_intent_id: pi.id,
        tip_cents: tipCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taxiRideId);

    return taxiJson({
      ok: true,
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
      amount_cents: tipCents,
      currency,
      taxi_ride_id: taxiRideId,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
