import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import {
  getSupabaseAdminClient,
  getSupabaseUserClient,
  getTaxiRideId,
  normalizeStatus,
  taxiJson,
} from "@/lib/taxiApi";
import { assertTaxiCheckoutCurrencyAllowed } from "@/lib/taxiCurrencyGuard";
import { snapshotFromRideRow } from "@/lib/taxiFinalPrice";
import {
  alignTaxiAmountCentsForZeroDecimal,
  formatTaxiCheckoutAmount,
  toStripeAmount,
} from "@/lib/taxiStripeAmounts";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  taxiRideId?: string;
  taxi_ride_id?: string;
  successUrl?: string;
  cancelUrl?: string;
};

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function buildCheckoutUrls(taxiRideId: string, req: NextRequest) {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    req.nextUrl.origin.replace(/\/$/, "");

  return {
    successUrl: `${origin}/stripe/success?taxiRideId=${encodeURIComponent(taxiRideId)}`,
    cancelUrl: `${origin}/stripe/cancel?taxiRideId=${encodeURIComponent(taxiRideId)}`,
  };
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
        "id,client_user_id,status,payment_status,total_cents,currency,tax_cents,stripe_session_id,stripe_payment_intent_id,promotion_id,discount_cents,loyalty_reward_id,loyalty_discount_cents,shared_discount_cents,promo_code,vehicle_class,country_code,gross_total_cents,is_scheduled,business_account_id,business_member_id,business_trip_type,is_shared_ride,shared_ride_id,premium_driver_only"
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

    if (normalizeStatus(ride.payment_status) === "paid") {
      return taxiJson({
        ok: true,
        already_paid: true,
        taxi_ride_id: taxiRideId,
      });
    }

    const status = normalizeStatus(ride.status);
    if (!["quoted", "pending_payment", "draft", "scheduled"].includes(status)) {
      return taxiJson({ error: "Ride is not payable at this stage" }, 400);
    }

    if (ride.promo_code) {
      const { data: promoCheck, error: promoCheckError } = await supabaseAdmin.rpc(
        "validate_taxi_promotion",
        {
          p_code: ride.promo_code,
          p_user_id: user.id,
          p_total_cents: Number(ride.gross_total_cents ?? ride.total_cents ?? 0),
          p_ride_id: taxiRideId,
          p_vehicle_class: ride.vehicle_class,
          p_country_code: ride.country_code,
          p_currency: ride.currency,
        }
      );

      if (promoCheckError) {
        return taxiJson({ error: promoCheckError.message }, 500);
      }

      const promoObj = (promoCheck ?? {}) as Record<string, unknown>;
      if (promoObj.ok === false) {
        await supabaseAdmin.rpc("release_taxi_loyalty_redemption", {
          p_ride_id: taxiRideId,
        });
        return taxiJson(
          { error: String(promoObj.message ?? "promotion_invalid_at_checkout") },
          400
        );
      }
    }

    const launchConfig = await fetchTaxiCountryLaunchConfig(
      supabaseAdmin,
      String(ride.country_code ?? "US")
    );
    if (!launchConfig) {
      return taxiJson({ ok: false, error: "country_launch_config_missing" }, 400);
    }

    const checkoutLaunch = assertTaxiLaunchFeature(launchConfig, "checkout");
    if (checkoutLaunch.ok === false) {
      return taxiJson({ ok: false, ...checkoutLaunch }, 403);
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

    let amountCents = Math.round(Number(ride.total_cents ?? 0));
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return taxiJson({ error: "Invalid taxi ride amount" }, 400);
    }

    const currency = String(ride.currency ?? "USD").trim().toLowerCase();
    const alignedAmountCents = alignTaxiAmountCentsForZeroDecimal(currency, amountCents);
    if (alignedAmountCents <= 0) {
      return taxiJson({ error: "Invalid taxi ride amount" }, 400);
    }

    if (alignedAmountCents !== amountCents) {
      const previousTotalCents = amountCents;
      const { error: alignError } = await supabaseAdmin
        .from("taxi_rides")
        .update({
          total_cents: alignedAmountCents,
          updated_at: new Date().toISOString(),
        })
        .eq("id", taxiRideId);

      if (alignError) {
        return taxiJson(
          {
            ok: false,
            error: "taxi_zero_decimal_alignment_failed",
            message: "Could not align ride total for zero-decimal currency",
          },
          500
        );
      }

      amountCents = alignedAmountCents;
      ride.total_cents = alignedAmountCents;

      await logTaxiEventServer(supabaseAdmin, {
        rideId: taxiRideId,
        eventType: "zero_decimal_amount_aligned",
        triggeredRole: "system",
        description: "Ride total floored to whole major units for zero-decimal currency",
        metadata: {
          currency: currency.toUpperCase(),
          previous_total_cents: previousTotalCents,
          aligned_total_cents: alignedAmountCents,
        },
      });
    }
    const checkoutCurrency = assertTaxiCheckoutCurrencyAllowed(currency);
    if (checkoutCurrency.ok === false) {
      return taxiJson(
        {
          ok: false,
          error: checkoutCurrency.error,
          message: checkoutCurrency.message,
          currency: checkoutCurrency.currency,
        },
        400
      );
    }

    const priceSnapshot = snapshotFromRideRow(ride);
    if (priceSnapshot.total_cents !== amountCents) {
      return taxiJson(
        {
          ok: false,
          error: "taxi_price_snapshot_mismatch",
          message: "Ride total does not match computed price snapshot",
          ride_total_cents: amountCents,
          snapshot_total_cents: priceSnapshot.total_cents,
        },
        409
      );
    }

    const stripeUnitAmount = toStripeAmount(currency, amountCents);
    if (stripeUnitAmount <= 0) {
      return taxiJson({ error: "Invalid taxi ride amount for Stripe" }, 400);
    }

    const taxCents = Math.round(Number((ride as { tax_cents?: number }).tax_cents ?? 0));
    const promoDiscountCents = Math.round(Number(ride.discount_cents ?? 0));
    const loyaltyDiscountCents = Math.round(Number(ride.loyalty_discount_cents ?? 0));
    const sharedDiscountCents = Math.round(Number(ride.shared_discount_cents ?? 0));
    const totalDiscountCents =
      promoDiscountCents + loyaltyDiscountCents + sharedDiscountCents;
    const urls = buildCheckoutUrls(taxiRideId, req);
    const idempotencyKey = `taxi_checkout_${taxiRideId}_${user.id}_${stripeUnitAmount}_${currency}`;
    const checkoutLabel = formatTaxiCheckoutAmount(currency, amountCents);

    await supabaseAdmin
      .from("taxi_rides")
      .update({
        status: "pending_payment",
        payment_status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taxiRideId)
      .neq("payment_status", "paid");

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        client_reference_id: taxiRideId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency,
              unit_amount: stripeUnitAmount,
              product_data: {
                name: `MMD Taxi ${taxiRideId.slice(0, 8)}`,
                description: `Taxi ride payment • ${checkoutLabel}`,
              },
            },
          },
        ],
        success_url: body.successUrl?.trim() || urls.successUrl,
        cancel_url: body.cancelUrl?.trim() || urls.cancelUrl,
        metadata: {
          module: "taxi",
          taxi_ride_id: taxiRideId,
          taxiRideId: taxiRideId,
          user_id: String(user.id),
          amount_cents: String(amountCents),
          stripe_amount: String(stripeUnitAmount),
          amount_dollars: checkoutLabel,
          tax_cents: String(taxCents),
          currency: currency.toUpperCase(),
          promotion_id: ride.promotion_id ? String(ride.promotion_id) : "",
          reward_id: ride.loyalty_reward_id ? String(ride.loyalty_reward_id) : "",
          discount_cents: String(totalDiscountCents),
          loyalty_discount_cents: String(loyaltyDiscountCents),
          shared_discount_cents: String(sharedDiscountCents),
          business_account_id: ride.business_account_id
            ? String(ride.business_account_id)
            : "",
          business_trip_type: String(ride.business_trip_type ?? "personal"),
          is_shared_ride: ride.is_shared_ride ? "true" : "false",
          premium_driver_only: ride.premium_driver_only ? "true" : "false",
          source_route: "/api/stripe/client/create-taxi-checkout-session",
        },
        payment_intent_data: {
          metadata: {
            module: "taxi",
            taxi_ride_id: taxiRideId,
            taxiRideId: taxiRideId,
            user_id: String(user.id),
            amount_cents: String(amountCents),
            stripe_amount: String(stripeUnitAmount),
            amount_dollars: checkoutLabel,
            tax_cents: String(taxCents),
            currency: currency.toUpperCase(),
            promotion_id: ride.promotion_id ? String(ride.promotion_id) : "",
            reward_id: ride.loyalty_reward_id ? String(ride.loyalty_reward_id) : "",
            discount_cents: String(totalDiscountCents),
            loyalty_discount_cents: String(loyaltyDiscountCents),
            shared_discount_cents: String(sharedDiscountCents),
            business_account_id: ride.business_account_id
              ? String(ride.business_account_id)
              : "",
            business_trip_type: String(ride.business_trip_type ?? "personal"),
            is_shared_ride: ride.is_shared_ride ? "true" : "false",
            premium_driver_only: ride.premium_driver_only ? "true" : "false",
            source_route: "/api/stripe/client/create-taxi-checkout-session",
          },
        },
      },
      { idempotencyKey }
    );

    if (!session.id || !session.url) {
      return taxiJson({ error: "Stripe returned an invalid checkout session" }, 500);
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent &&
            typeof session.payment_intent === "object" &&
            "id" in session.payment_intent
          ? String((session.payment_intent as { id?: string }).id ?? "")
          : null;

    await supabaseAdmin
      .from("taxi_rides")
      .update({
        stripe_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", taxiRideId);

    await logTaxiEventServer(supabaseAdmin, {
      rideId: taxiRideId,
      eventType: "checkout_started",
      oldStatus: status,
      newStatus: "pending_payment",
      actorId: user.id,
      triggeredRole: "client",
      description: "Taxi checkout session created",
      metadata: { stripe_session_id: session.id, promotion_id: ride.promotion_id },
    });

    return taxiJson({
      ok: true,
      url: session.url,
      session_id: session.id,
      taxi_ride_id: taxiRideId,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("[create-taxi-checkout-session]", message);
    return taxiJson({ error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
