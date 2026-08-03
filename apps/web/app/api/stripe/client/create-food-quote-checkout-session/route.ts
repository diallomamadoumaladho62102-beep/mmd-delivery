/**
 * Stripe Checkout from a food quote — NO orders row until payment succeeds.
 */
import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireFoodClientAuth } from "@/lib/foodOrderApiAuth";
import {
  countryCodeFromFoodAuthScope,
  parseFoodOrderRequestBody,
  readFoodOrderBodyFields,
  validateFoodOrderBodyFields,
} from "@/lib/foodOrderApiShared";
import { assertRestaurantCanAcceptOrders } from "@/lib/restaurantAcceptGate";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import {
  createFoodCheckoutIntent,
  openFoodQuoteCheckoutSession,
  type FoodCheckoutIntentSnapshot,
} from "@/lib/food/foodCheckoutFromQuote";
import { quoteFoodSot } from "@/lib/pricingEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireFoodClientAuth(req);
  if (auth.ok === false) return auth.response;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const body = parseFoodOrderRequestBody(rawBody);
    const fields = readFoodOrderBodyFields(body);
    validateFoodOrderBodyFields(fields);

    const expectedTotalCents = Math.round(
      Number(
        rawBody.expectedQuoteTotalCents ??
          rawBody.expected_quote_total_cents ??
          rawBody.expected_total_cents ??
          0,
      ),
    );

    const scopeCountry = countryCodeFromFoodAuthScope(auth.scope);
    const countryCode = inferPlatformCountryCode({
      countryCode: scopeCountry,
      lat: fields.dropoffLat,
      lng: fields.dropoffLng,
    });

    const restaurantGate = await assertRestaurantCanAcceptOrders(
      auth.supabaseAdmin,
      fields.restaurantUserId,
    );
    if (restaurantGate.ok === false) {
      return mmdLocationJson(
        {
          ok: false,
          error: restaurantGate.error,
          message: restaurantGate.message,
        },
        restaurantGate.httpStatus,
      );
    }
    const restaurantProfile = restaurantGate.profile;
    const restaurantName =
      fields.restaurantName ||
      String(restaurantProfile.restaurant_name ?? "Restaurant");

    const pricing = await quoteFoodSot({
      supabaseAdmin: auth.supabaseAdmin,
      restaurantUserId: fields.restaurantUserId,
      items: fields.items,
      pickupAddress: fields.pickupAddress,
      dropoffAddress: fields.dropoffAddress,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      countryCode,
      promoCode: fields.promoCode,
      clientUserId: auth.user.id,
    });

    const amountCents = Math.round(Number(pricing.totalCents));
    if (!amountCents || amountCents <= 0) {
      return mmdLocationJson({ ok: false, error: "invalid_quote_total" }, 400);
    }
    if (
      Number.isFinite(expectedTotalCents) &&
      expectedTotalCents > 0 &&
      Math.abs(amountCents - expectedTotalCents) > 1
    ) {
      return mmdLocationJson(
        {
          ok: false,
          error: "quote_price_changed",
          expected_quote_total_cents: expectedTotalCents,
          current_total_cents: amountCents,
        },
        409,
      );
    }

    const snapshot: FoodCheckoutIntentSnapshot = {
      version: 1,
      client_user_id: auth.user.id,
      restaurant_user_id: fields.restaurantUserId,
      restaurant_name: restaurantName,
      pickup_address: fields.pickupAddress,
      pickup_lat: fields.pickupLat,
      pickup_lng: fields.pickupLng,
      dropoff_address: fields.dropoffAddress,
      dropoff_lat: fields.dropoffLat,
      dropoff_lng: fields.dropoffLng,
      items: fields.items,
      country_code: countryCode,
      promo_code: fields.promoCode,
      leave_at_door: fields.leaveAtDoor === true,
      currency: String(pricing.currency ?? "USD").toUpperCase(),
      amount_cents: amountCents,
      charge_path: "engine",
      pricing_snapshot_id: null,
      frozen_pricing: pricing,
    };

    const intent = await createFoodCheckoutIntent({
      supabaseAdmin: auth.supabaseAdmin,
      snapshot,
    });
    if (intent.ok === false) {
      return mmdLocationJson({ ok: false, error: intent.error }, 500);
    }

    const checkout = await openFoodQuoteCheckoutSession({
      supabaseAdmin: auth.supabaseAdmin,
      intentId: intent.intentId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      snapshot,
    });
    if (checkout.ok === false) {
      return mmdLocationJson(
        { ok: false, error: checkout.error },
        checkout.status ?? 500,
      );
    }

    return mmdLocationJson({
      ok: true,
      pay_then_create: true,
      food_checkout_id: intent.intentId,
      session_id: checkout.sessionId,
      url: checkout.url,
      amount_cents: amountCents,
      currency: snapshot.currency,
      order_id: null,
      charge_path: "engine",
      pricing_snapshot_id: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[create-food-quote-checkout-session]", message);
    return mmdLocationJson({ ok: false, error: message }, 500);
  }
}
