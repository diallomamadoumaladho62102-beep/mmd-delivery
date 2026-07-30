/**
 * Stripe Checkout from a delivery quote — NO delivery_requests row until paid.
 */
import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireDeliveryClientAuth } from "@/lib/deliveryRequestApiAuth";
import {
  countryCodeFromDeliveryAuthScope,
  parseDeliveryRequestBody,
  readDeliveryRequestFields,
  validateDeliveryRequestFields,
} from "@/lib/deliveryRequestApiShared";
import { computeDeliveryRequestPricing } from "@/lib/deliveryRequestServerPricing";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";
import {
  createDeliveryCheckoutIntent,
  openDeliveryQuoteCheckoutSession,
  type DeliveryCheckoutIntentSnapshot,
} from "@/lib/delivery/deliveryCheckoutFromQuote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireDeliveryClientAuth(req);
  if (auth.ok === false) return auth.response;

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const body = parseDeliveryRequestBody(rawBody);
    const fields = readDeliveryRequestFields(body);
    validateDeliveryRequestFields(fields);

    const expectedTotalCents = Math.round(
      Number(
        rawBody.expectedQuoteTotalCents ??
          rawBody.expected_quote_total_cents ??
          rawBody.expected_total_cents ??
          0,
      ),
    );

    const scopeCountry = countryCodeFromDeliveryAuthScope(auth.scope);
    const countryCode = inferPlatformCountryCode({
      countryCode: scopeCountry,
      lat: fields.dropoffLat,
      lng: fields.dropoffLng,
    });

    const safeTitle =
      fields.title ||
      (fields.requestType === "ride" ? "Private ride request" : "Package delivery");

    const pricing = await computeDeliveryRequestPricing({
      supabaseAdmin: auth.supabaseAdmin,
      pickupAddress: fields.pickupAddress,
      dropoffAddress: fields.dropoffAddress,
      pickupLat: fields.pickupLat,
      pickupLng: fields.pickupLng,
      dropoffLat: fields.dropoffLat,
      dropoffLng: fields.dropoffLng,
      countryCode,
      promoCode: fields.promoCode,
      subtotal: 0,
      clientUserId: auth.user.id,
    });

    const amountCents = Math.round(Number(pricing.totalCents ?? 0));
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

    const snapshot: DeliveryCheckoutIntentSnapshot = {
      version: 1,
      client_user_id: auth.user.id,
      request_type: fields.requestType,
      title: safeTitle,
      description: fields.description,
      pickup_address: fields.pickupAddress,
      dropoff_address: fields.dropoffAddress,
      pickup_contact_name: fields.pickupContactName,
      pickup_phone: fields.pickupPhone,
      dropoff_contact_name: fields.dropoffContactName,
      dropoff_phone: fields.dropoffPhone,
      pickup_lat: fields.pickupLat,
      pickup_lng: fields.pickupLng,
      dropoff_lat: fields.dropoffLat,
      dropoff_lng: fields.dropoffLng,
      dropoff_location_id: fields.dropoffLocationId,
      country_code: countryCode,
      promo_code: fields.promoCode,
      leave_at_door: fields.leaveAtDoor === true,
      currency: String(pricing.currency ?? "USD").toUpperCase(),
      amount_cents: amountCents,
    };

    const intent = await createDeliveryCheckoutIntent({
      supabaseAdmin: auth.supabaseAdmin,
      snapshot,
    });
    if (intent.ok === false) {
      return mmdLocationJson({ ok: false, error: intent.error }, 500);
    }

    const checkout = await openDeliveryQuoteCheckoutSession({
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
      delivery_checkout_id: intent.intentId,
      session_id: checkout.sessionId,
      url: checkout.url,
      amount_cents: amountCents,
      currency: snapshot.currency,
      delivery_request_id: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[create-delivery-quote-checkout-session]", message);
    return mmdLocationJson({ ok: false, error: message }, 500);
  }
}
