/**
 * Taxi pay-then-create: quote checkout intents + materialize paid ride after Stripe.
 * No taxi_rides row exists until PaymentIntent succeeds.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { requirePaymentIntentSucceeded } from "@/lib/requirePaymentIntentSucceeded";
import { scheduleTaxiRideDispatchIfEligible } from "@/lib/taxiSharedRideDispatch";
import { bridgeStripeWalletFromPaidTaxiRide } from "@/lib/stripeInboundWalletBridge";
import { enqueueTaxiPaidFailOpen } from "@/lib/finance/financeEvents";
import {
  alignTaxiAmountCentsForZeroDecimal,
  formatTaxiCheckoutAmount,
  toStripeAmount,
} from "@/lib/taxiStripeAmounts";
import { assertTaxiCheckoutCurrencyAllowed } from "@/lib/taxiCurrencyGuard";
import { assertStripeCheckoutAllowed } from "@/lib/paymentProviderRouting";
import { buildStripeCheckoutReturnUrls } from "@/lib/productionSite";
import { captureEntityCredit } from "@/lib/loyalty/loyaltyCredit";

export const TAXI_QUOTE_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export type TaxiCheckoutIntentSnapshot = {
  version: 1;
  client_user_id: string;
  country_code: string;
  currency: string;
  amount_cents: number;
  vehicle_class: string;
  passenger_count: number;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  pickup_city?: string | null;
  distance_miles: number;
  duration_minutes: number;
  pricing_snapshot_id?: string | null;
  subtotal_cents: number;
  tax_cents: number;
  platform_fee_cents: number;
  driver_payout_cents: number;
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
  gross_total_cents: number;
  mmd_plus_discount_cents: number;
  discount_cents?: number;
  marketing_discount_cents?: number;
  promotion_id?: string | null;
  marketing_reservation_id?: string | null;
  marketing_campaign_ids?: string[];
  fare_components?: Record<string, unknown> | null;
  stops?: Array<{
    stop_order: number;
    address: string;
    lat: number;
    lng: number;
  }>;
  preferred_driver_id?: string | null;
  premium_driver_only?: boolean;
  prefer_electric_or_hybrid?: boolean;
  electric_search_until?: string | null;
  client_preferences?: Record<string, unknown>;
  ambiance_preference?: string | null;
  client_notes?: string | null;
  business_account_id?: string | null;
  business_member_id?: string | null;
  business_trip_type?: string;
  business_approval_status?: string;
  trip_mode?: string;
  return_mode?: string | null;
  return_wait_minutes?: number | null;
  return_scheduled_at?: string | null;
  is_shared_ride?: boolean;
  promo_code?: string | null;
  /** Phase 4 Pricing Engine charge path (defaults legacy when absent). */
  charge_path?: "legacy" | "engine";
  /** Immutable Pricing Engine quote snapshot id (not taxi_pricing.id). */
  engine_quote_snapshot_id?: string | null;
};

export function hashTaxiCheckoutSnapshot(
  snapshot: TaxiCheckoutIntentSnapshot,
): string {
  const canonical = JSON.stringify(snapshot);
  return createHash("sha256").update(canonical).digest("hex");
}

export function pickTaxiQuoteCheckoutId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const raw =
    metadata.quote_checkout_id ??
    metadata.quoteCheckoutId ??
    metadata.taxi_quote_checkout_id ??
    null;
  const id = String(raw ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function createTaxiCheckoutIntent(params: {
  supabaseAdmin: SupabaseClient;
  snapshot: TaxiCheckoutIntentSnapshot;
  intentId?: string;
}): Promise<{ ok: true; intentId: string } | { ok: false; error: string }> {
  const quoteHash = hashTaxiCheckoutSnapshot(params.snapshot);
  const expiresAt = new Date(Date.now() + TAXI_QUOTE_CHECKOUT_TTL_MS).toISOString();
  const intentId = String(params.intentId ?? "").trim();
  const { data, error } = await params.supabaseAdmin
    .from("taxi_checkout_intents")
    .insert({
      ...(intentId ? { id: intentId } : {}),
      client_user_id: params.snapshot.client_user_id,
      status: "pending",
      currency: params.snapshot.currency,
      amount_cents: params.snapshot.amount_cents,
      quote_hash: quoteHash,
      snapshot: params.snapshot,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? "intent_insert_failed" };
  }
  return { ok: true, intentId: String(data.id) };
}

export async function openTaxiQuoteCheckoutSession(params: {
  supabaseAdmin: SupabaseClient;
  intentId: string;
  userId: string;
  userEmail?: string | null;
  snapshot: TaxiCheckoutIntentSnapshot;
}): Promise<
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: string; status?: number }
> {
  const currency = String(params.snapshot.currency ?? "USD").toUpperCase();
  const currencyCheck = assertTaxiCheckoutCurrencyAllowed(currency);
  if (currencyCheck.ok === false) {
    return { ok: false, error: currencyCheck.error, status: 400 };
  }
  const stripeGate = assertStripeCheckoutAllowed(params.snapshot.country_code);
  if (stripeGate.ok === false) {
    return { ok: false, error: stripeGate.message, status: 403 };
  }

  const amountCents = alignTaxiAmountCentsForZeroDecimal(
    currency,
    params.snapshot.amount_cents,
  );
  if (!amountCents || amountCents <= 0) {
    return { ok: false, error: "invalid_amount", status: 400 };
  }

  const stripeAmount = toStripeAmount(currency, amountCents);
  const urls = buildStripeCheckoutReturnUrls({
    successQuery: { quoteCheckoutId: params.intentId },
    cancelQuery: { quoteCheckoutId: params.intentId },
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer_email: params.userEmail || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: stripeAmount,
            product_data: {
              name: "MMD Taxi",
              description: formatTaxiCheckoutAmount(currency, amountCents),
            },
          },
        },
      ],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      client_reference_id: params.intentId,
      metadata: {
        metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
        service_type: "taxi",
        module: "taxi",
        quote_checkout_id: params.intentId,
        user_id: params.userId,
        amount_cents: String(amountCents),
        stripe_amount: String(stripeAmount),
        currency,
        tax_cents: String(params.snapshot.tax_cents ?? 0),
        source_route: "create-taxi-quote-checkout-session",
        quote_hash: hashTaxiCheckoutSnapshot(params.snapshot).slice(0, 32),
      },
      payment_intent_data: {
        metadata: {
          metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
          service_type: "taxi",
          module: "taxi",
          quote_checkout_id: params.intentId,
          user_id: params.userId,
          amount_cents: String(amountCents),
          currency,
        },
      },
    },
    {
      idempotencyKey: `taxi_quote_checkout_${params.intentId}_${amountCents}_${currency}`,
    },
  );

  if (!session.url || !session.id) {
    return { ok: false, error: "checkout_session_missing_url", status: 500 };
  }

  await params.supabaseAdmin
    .from("taxi_checkout_intents")
    .update({
      status: "checkout_open",
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.intentId);

  return { ok: true, url: session.url, sessionId: session.id };
}

function toPositiveInt(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function materializePaidTaxiRideFromQuoteCheckout(params: {
  supabaseAdmin: SupabaseClient;
  quoteCheckoutId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  expectedCurrency?: string | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
  metadata?: Record<string, unknown> | null;
}): Promise<
  | {
      ok: true;
      taxi_ride_id: string;
      already_paid?: boolean;
      created?: boolean;
    }
  | { ok: false; error: string }
> {
  const { supabaseAdmin, quoteCheckoutId } = params;

  const { data: intent, error: intentErr } = await supabaseAdmin
    .from("taxi_checkout_intents")
    .select("*")
    .eq("id", quoteCheckoutId)
    .maybeSingle();

  if (intentErr) return { ok: false, error: intentErr.message };
  if (!intent) return { ok: false, error: "quote_checkout_not_found" };

  if (intent.taxi_ride_id) {
    return {
      ok: true,
      taxi_ride_id: String(intent.taxi_ride_id),
      already_paid: true,
      created: false,
    };
  }

  if (new Date(String(intent.expires_at)).getTime() < Date.now()) {
    if (String(intent.status) !== "paid") {
      await supabaseAdmin
        .from("taxi_checkout_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", quoteCheckoutId);
    }
    return { ok: false, error: "quote_checkout_expired" };
  }

  const snapshot = intent.snapshot as TaxiCheckoutIntentSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, error: "quote_snapshot_missing" };
  }

  const amountCents = toPositiveInt(intent.amount_cents);
  const stripeAmountCents = toPositiveInt(params.expectedAmountCents);
  if (!stripeAmountCents) return { ok: false, error: "missing_stripe_amount" };
  if (stripeAmountCents !== toStripeAmount(String(intent.currency), amountCents)) {
    // Compare in Stripe units: intent stores major-currency cents already aligned.
    const expectedStripe = toStripeAmount(
      String(intent.currency ?? snapshot.currency),
      amountCents,
    );
    if (stripeAmountCents !== expectedStripe && stripeAmountCents !== amountCents) {
      return { ok: false, error: "amount_mismatch" };
    }
  }

  const settled = await requirePaymentIntentSucceeded({
    paymentIntentId: params.paymentIntentId ?? null,
    sessionId: params.sessionId ?? intent.stripe_checkout_session_id ?? null,
    paymentIntent: params.paymentIntent ?? null,
  });
  if (!settled.ok) {
    return { ok: false, error: `payment_intent_not_succeeded:${settled.reason}` };
  }

  const paymentIntentId =
    settled.payment_intent_id ||
    String(params.paymentIntentId ?? "").trim() ||
    null;
  const sessionId =
    String(params.sessionId ?? intent.stripe_checkout_session_id ?? "").trim() ||
    null;

  const stops = Array.isArray(snapshot.stops) ? snapshot.stops : [];
  const rideInsert = {
    client_user_id: snapshot.client_user_id,
    vehicle_class: snapshot.vehicle_class || "standard",
    status: "paid",
    payment_status: "paid",
    paid_at: new Date().toISOString(),
    pickup_address: snapshot.pickup_address,
    pickup_lat: snapshot.pickup_lat,
    pickup_lng: snapshot.pickup_lng,
    pickup_city: snapshot.pickup_city ?? null,
    pickup_location_id: snapshot.pickup_location_id ?? null,
    dropoff_address: snapshot.dropoff_address,
    dropoff_lat: snapshot.dropoff_lat,
    dropoff_lng: snapshot.dropoff_lng,
    dropoff_location_id: snapshot.dropoff_location_id ?? null,
    distance_miles: snapshot.distance_miles,
    duration_minutes: snapshot.duration_minutes,
    country_code: snapshot.country_code,
    currency: snapshot.currency,
    pricing_snapshot_id: snapshot.pricing_snapshot_id ?? null,
    subtotal_cents: snapshot.subtotal_cents ?? 0,
    tax_cents: snapshot.tax_cents ?? 0,
    platform_fee_cents: snapshot.platform_fee_cents ?? 0,
    driver_payout_cents: snapshot.driver_payout_cents ?? 0,
    service_fee_cents: snapshot.service_fee_cents ?? 0,
    service_fee_pct: snapshot.service_fee_pct ?? 0,
    service_fee_enabled: snapshot.service_fee_enabled === true,
    service_fee_fixed_cents: snapshot.service_fee_fixed_cents ?? 0,
    total_cents: snapshot.amount_cents,
    gross_total_cents: snapshot.gross_total_cents ?? snapshot.amount_cents,
    mmd_plus_discount_cents: snapshot.mmd_plus_discount_cents ?? 0,
    discount_cents: snapshot.discount_cents ?? 0,
    marketing_discount_cents: snapshot.marketing_discount_cents ?? 0,
    promotion_id: snapshot.promotion_id ?? null,
    promo_code: snapshot.promo_code ?? null,
    marketing_reservation_id: snapshot.marketing_reservation_id ?? null,
    marketing_campaign_ids: snapshot.marketing_campaign_ids ?? [],
    passenger_count: snapshot.passenger_count ?? 1,
    client_notes: snapshot.client_notes ?? null,
    preferred_driver_id: snapshot.preferred_driver_id ?? null,
    stop_count: stops.length,
    premium_driver_only: snapshot.premium_driver_only === true,
    prefer_electric_or_hybrid: snapshot.prefer_electric_or_hybrid === true,
    electric_search_until: snapshot.electric_search_until ?? null,
    electric_search_expired: false,
    client_preferences: snapshot.client_preferences ?? {},
    ambiance_preference: snapshot.ambiance_preference ?? "none",
    business_account_id: snapshot.business_account_id ?? null,
    business_member_id: snapshot.business_member_id ?? null,
    business_trip_type: snapshot.business_trip_type ?? "personal",
    business_approval_status: snapshot.business_approval_status ?? "not_required",
    trip_mode: snapshot.trip_mode ?? "one_way",
    return_mode: snapshot.return_mode ?? null,
    return_wait_minutes: snapshot.return_wait_minutes ?? null,
    return_scheduled_at: snapshot.return_scheduled_at ?? null,
    is_shared_ride: snapshot.is_shared_ride === true,
    stripe_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    fare_components: snapshot.fare_components ?? null,
    expires_at: null,
  };

  let { data: ride, error: insertError } = await supabaseAdmin
    .from("taxi_rides")
    .insert(rideInsert)
    .select("id,total_cents,currency,country_code,preferred_driver_id,is_scheduled,platform_fee_cents,driver_payout_cents,client_user_id,stripe_payment_intent_id")
    .single();

  if (
    insertError &&
    /fare_components|column/i.test(String(insertError.message ?? ""))
  ) {
    const { fare_components: _fc, ...withoutFc } = rideInsert;
    const retry = await supabaseAdmin
      .from("taxi_rides")
      .insert(withoutFc)
      .select("id,total_cents,currency,country_code,preferred_driver_id,is_scheduled,platform_fee_cents,driver_payout_cents,client_user_id,stripe_payment_intent_id")
      .single();
    ride = retry.data;
    insertError = retry.error;
  }

  if (insertError || !ride?.id) {
    // Race: another worker may have materialized — re-read intent.
    const { data: again } = await supabaseAdmin
      .from("taxi_checkout_intents")
      .select("taxi_ride_id")
      .eq("id", quoteCheckoutId)
      .maybeSingle();
    if (again?.taxi_ride_id) {
      return {
        ok: true,
        taxi_ride_id: String(again.taxi_ride_id),
        already_paid: true,
        created: false,
      };
    }
    return { ok: false, error: insertError?.message ?? "ride_insert_failed" };
  }

  const taxiRideId = String(ride.id);

  if (stops.length > 0) {
    await supabaseAdmin.from("taxi_ride_stops").insert(
      stops.map((stop) => ({
        taxi_ride_id: taxiRideId,
        stop_order: stop.stop_order,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
      })),
    );
  }

  await supabaseAdmin
    .from("taxi_checkout_intents")
    .update({
      status: "paid",
      taxi_ride_id: taxiRideId,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", quoteCheckoutId);

  if (paymentIntentId) {
    const walletBridge = await bridgeStripeWalletFromPaidTaxiRide(supabaseAdmin, {
      paymentIntentId,
      taxiRide: ride,
      source: params.source,
    });
    if (walletBridge.ok === false) {
      console.warn("[taxi quote-checkout] wallet bridge", walletBridge.error);
    }
  }

  try {
    await captureEntityCredit(supabaseAdmin, "taxi_ride", taxiRideId);
  } catch (e) {
    console.warn("[taxi quote-checkout] credit capture", e);
  }

  try {
    const { captureEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await captureEntityMarketing(
      supabaseAdmin,
      "taxi",
      taxiRideId,
      snapshot.marketing_reservation_id ?? null,
    );
  } catch (e) {
    console.warn("[taxi quote-checkout] marketing capture", e);
  }

  await enqueueTaxiPaidFailOpen({
    supabaseAdmin,
    taxiRideId,
    amountCents: Number(ride.total_cents ?? amountCents),
    currency: String(ride.currency ?? snapshot.currency),
    countryCode: ride.country_code ?? snapshot.country_code,
    paymentIntentId,
    commissionCents: Math.round(Number(ride.platform_fee_cents ?? 0)),
    partnerCents: Math.round(Number(ride.driver_payout_cents ?? 0)),
  });

  await scheduleTaxiRideDispatchIfEligible({
    supabase: supabaseAdmin,
    origin: params.source,
    taxiRideId,
    rideForWave: ride,
  });

  return { ok: true, taxi_ride_id: taxiRideId, created: true };
}

export async function resolveTaxiQuoteCheckoutPayment(params: {
  supabaseAdmin: SupabaseClient;
  metadata?: Record<string, unknown> | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  expectedCurrency?: string | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
}): Promise<
  | { ok: true; taxi_ride_id: string; already_paid?: boolean }
  | { ok: false; error: string; ignored?: boolean }
> {
  const quoteCheckoutId = pickTaxiQuoteCheckoutId(params.metadata);
  if (!quoteCheckoutId) {
    return { ok: false, error: "missing_quote_checkout_id", ignored: true };
  }
  return materializePaidTaxiRideFromQuoteCheckout({
    supabaseAdmin: params.supabaseAdmin,
    quoteCheckoutId,
    sessionId: params.sessionId,
    paymentIntentId: params.paymentIntentId,
    expectedAmountCents: params.expectedAmountCents,
    expectedCurrency: params.expectedCurrency,
    source: params.source,
    paymentIntent: params.paymentIntent,
    metadata: params.metadata,
  });
}
