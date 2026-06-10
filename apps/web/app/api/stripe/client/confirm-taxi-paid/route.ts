import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { scheduleTaxiRideDispatchIfEligible } from "@/lib/taxiSharedRideDispatch";
import {
  getSupabaseAdminClient,
  getSupabaseUserClient,
  getTaxiRideId,
  normalizeStatus,
  taxiJson,
} from "@/lib/taxiApi";
import {
  isAmountVerificationFailure,
  verifyStripePaidMatchesTaxiRide,
} from "@/lib/verifyStripePaidTaxi";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  taxiRideId?: string;
  taxi_ride_id?: string;
};

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

async function stripePaymentLooksPaid(ride: {
  id: string;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
}) {
  const paymentIntentId = String(ride.stripe_payment_intent_id ?? "").trim();
  const sessionId = String(ride.stripe_session_id ?? "").trim();

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (String(pi.status).toLowerCase() === "succeeded") {
        return {
          paid: true,
          payment_intent_id: pi.id,
          source: "payment_intent" as const,
        };
      }
    } catch {
      // fall through
    }
  }

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      if (
        String(session.payment_status).toLowerCase() === "paid" ||
        String(session.status).toLowerCase() === "complete"
      ) {
        return {
          paid: true,
          payment_intent_id:
            paymentIntentIdFromUnknown(session.payment_intent) ?? paymentIntentId,
          source: "checkout_session" as const,
        };
      }
    } catch {
      // fall through
    }
  }

  return { paid: false, payment_intent_id: paymentIntentId || null, source: "none" as const };
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) {
      return taxiJson({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    let taxiRideId = "";

    try {
      taxiRideId = getTaxiRideId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ error: message }, 400);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const supabaseAdmin = getSupabaseAdminClient();

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user?.id) {
      return taxiJson({ error: "Invalid token" }, 401);
    }

    const { data: ride, error: rideError } = await supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,client_user_id,status,payment_status,total_cents,currency,country_code,stripe_session_id,stripe_payment_intent_id,paid_at,preferred_driver_id,is_scheduled"
      )
      .eq("id", taxiRideId)
      .maybeSingle();

    if (rideError) {
      return taxiJson({ error: rideError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ error: "Taxi ride not found" }, 404);
    }

    if (String(ride.client_user_id) !== user.id) {
      return taxiJson({ error: "Forbidden" }, 403);
    }

    const platformCheckout = await assertPlatformFeature(
      supabaseAdmin,
      String(ride.country_code ?? "US"),
      "taxi",
      "checkout"
    );
    if (platformCheckout.ok === false) {
      return taxiJson({ ok: false, ...platformCheckout }, 403);
    }

    if (normalizeStatus(ride.payment_status) === "paid") {
      return taxiJson({
        ok: true,
        already: true,
        taxi_ride_id: taxiRideId,
        payment_status: "paid",
      });
    }

    const stripeCheck = await stripePaymentLooksPaid(ride);

    if (!stripeCheck.paid) {
      return taxiJson(
        {
          ok: false,
          error: "Stripe payment not confirmed yet",
          taxi_ride_id: taxiRideId,
        },
        409
      );
    }

    const amountCheck = await verifyStripePaidMatchesTaxiRide(ride, {
      paymentIntentId:
        stripeCheck.payment_intent_id ?? ride.stripe_payment_intent_id,
      sessionId: ride.stripe_session_id,
    });

    if (isAmountVerificationFailure(amountCheck)) {
      return taxiJson(
        {
          ok: false,
          error: amountCheck.error,
          taxi_ride_id: taxiRideId,
          expected_cents: amountCheck.expected_cents ?? null,
          actual_cents: amountCheck.actual_cents ?? null,
        },
        amountCheck.error === "missing_expected_amount" ? 400 : 409
      );
    }

    const oldStatus = String(ride.status ?? "");

    const { data: markResult, error: markError } = await supabaseAdmin.rpc(
      "mark_taxi_ride_paid",
      {
        p_ride_id: taxiRideId,
        p_session_id: amountCheck.session_id ?? ride.stripe_session_id,
        p_payment_intent_id:
          amountCheck.payment_intent_id ??
          stripeCheck.payment_intent_id ??
          ride.stripe_payment_intent_id,
      }
    );

    if (markError) {
      return taxiJson({ error: markError.message }, 500);
    }

    const markObj = (markResult ?? {}) as {
      ok?: boolean;
      already?: boolean;
      idempotent?: boolean;
      message?: string;
    };
    if (markObj.ok === false) {
      return taxiJson({ error: markObj.message ?? "Failed to mark taxi ride paid" }, 500);
    }

    const alreadyMarkedPaid =
      markObj.already === true || markObj.idempotent === true;

    if (!alreadyMarkedPaid) {
      await logTaxiEventServer(supabaseAdmin, {
        rideId: taxiRideId,
        eventType: "ride_paid",
        oldStatus,
        newStatus: "paid",
        actorId: user.id,
        triggeredRole: "client",
        description: "Taxi ride confirmed paid via client API",
        metadata: {
          stripe_payment_intent_id: amountCheck.payment_intent_id,
          stripe_session_id: amountCheck.session_id,
        },
      });

      await scheduleTaxiRideDispatchIfEligible({
        supabase: supabaseAdmin,
        origin: req.nextUrl.origin,
        taxiRideId,
        rideForWave: ride,
      });
    }

    return taxiJson({
      ok: true,
      taxi_ride_id: taxiRideId,
      payment_status: "paid",
      already: alreadyMarkedPaid,
      mark_result: markResult,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[confirm-taxi-paid]", message);
    return taxiJson({ error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
