/**
 * Package delivery pay-then-create: intents + materialize paid request after Stripe.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { requirePaymentIntentSucceeded } from "@/lib/requirePaymentIntentSucceeded";
import { assertStripeCheckoutAllowed } from "@/lib/paymentProviderRouting";
import {
  assertFoodCheckoutCurrencyAllowed,
  safeFoodCheckoutCurrency,
} from "@/lib/foodCurrencyGuard";
import { buildStripeCheckoutReturnUrls } from "@/lib/productionSite";
import { toStripeAmount } from "@/lib/taxiStripeAmounts";
import { createDeliveryRequestServerSide } from "@/lib/deliveryRequestService";
import { triggerDeliveryRequestDispatch } from "@/lib/triggerDeliveryRequestDispatch";
import { enqueuePaymentSucceeded } from "@/lib/finance/financeEvents";
import { bridgeStripeWalletFromPaidDeliveryRequest } from "@/lib/stripeInboundWalletBridge";
import { captureEntityCredit } from "@/lib/loyalty/loyaltyCredit";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export const DELIVERY_QUOTE_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export type DeliveryCheckoutIntentSnapshot = {
  version: 1;
  client_user_id: string;
  request_type: "package" | "ride";
  title: string;
  description?: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_contact_name?: string | null;
  pickup_phone?: string | null;
  dropoff_contact_name?: string | null;
  dropoff_phone?: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_location_id?: string | null;
  country_code: string;
  promo_code?: string | null;
  leave_at_door?: boolean;
  currency: string;
  amount_cents: number;
  /** Phase 3 Pricing Engine charge path (defaults legacy when absent). */
  charge_path?: "legacy" | "engine";
  pricing_snapshot_id?: string | null;
};

export function hashDeliveryCheckoutSnapshot(
  snapshot: DeliveryCheckoutIntentSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function pickDeliveryQuoteCheckoutId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const raw =
    metadata.delivery_checkout_id ??
    metadata.deliveryCheckoutId ??
    metadata.quote_checkout_id ??
    null;
  const id = String(raw ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function createDeliveryCheckoutIntent(params: {
  supabaseAdmin: SupabaseClient;
  snapshot: DeliveryCheckoutIntentSnapshot;
}): Promise<{ ok: true; intentId: string } | { ok: false; error: string }> {
  const { data, error } = await params.supabaseAdmin
    .from("delivery_checkout_intents")
    .insert({
      client_user_id: params.snapshot.client_user_id,
      status: "pending",
      currency: params.snapshot.currency,
      amount_cents: params.snapshot.amount_cents,
      quote_hash: hashDeliveryCheckoutSnapshot(params.snapshot),
      snapshot: params.snapshot,
      expires_at: new Date(
        Date.now() + DELIVERY_QUOTE_CHECKOUT_TTL_MS,
      ).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? "intent_insert_failed" };
  }
  return { ok: true, intentId: String(data.id) };
}

export async function openDeliveryQuoteCheckoutSession(params: {
  supabaseAdmin: SupabaseClient;
  intentId: string;
  userId: string;
  userEmail?: string | null;
  snapshot: DeliveryCheckoutIntentSnapshot;
}): Promise<
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: string; status?: number }
> {
  const currency = safeFoodCheckoutCurrency(params.snapshot.currency);
  const currencyCheck = assertFoodCheckoutCurrencyAllowed(currency);
  if (currencyCheck.ok === false) {
    return { ok: false, error: currencyCheck.error, status: 400 };
  }
  const stripeGate = assertStripeCheckoutAllowed(params.snapshot.country_code);
  if (stripeGate.ok === false) {
    return { ok: false, error: stripeGate.message, status: 403 };
  }

  const amountCents = Math.round(Number(params.snapshot.amount_cents ?? 0));
  if (!amountCents || amountCents <= 0) {
    return { ok: false, error: "invalid_amount", status: 400 };
  }

  const stripeAmount = toStripeAmount(currency, amountCents);
  const urls = buildStripeCheckoutReturnUrls({
    successQuery: { deliveryCheckoutId: params.intentId },
    cancelQuery: { deliveryCheckoutId: params.intentId },
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
              name: "MMD Delivery",
              description: `${params.snapshot.title} · ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`,
            },
          },
        },
      ],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      client_reference_id: params.intentId,
      metadata: {
        metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
        service_type: "delivery",
        module: "delivery",
        delivery_checkout_id: params.intentId,
        user_id: params.userId,
        amount_cents: String(amountCents),
        currency: currency.toUpperCase(),
        source_route: "create-delivery-quote-checkout-session",
      },
      payment_intent_data: {
        metadata: {
          metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
          service_type: "delivery",
          module: "delivery",
          delivery_checkout_id: params.intentId,
          user_id: params.userId,
          amount_cents: String(amountCents),
          currency: currency.toUpperCase(),
        },
      },
    },
    {
      idempotencyKey: `delivery_quote_checkout_${params.intentId}_${amountCents}_${currency}`,
    },
  );

  if (!session.url || !session.id) {
    return { ok: false, error: "checkout_session_missing_url", status: 500 };
  }

  await params.supabaseAdmin
    .from("delivery_checkout_intents")
    .update({
      status: "checkout_open",
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.intentId);

  return { ok: true, url: session.url, sessionId: session.id };
}

export async function materializePaidDeliveryRequestFromQuoteCheckout(params: {
  supabaseAdmin: SupabaseClient;
  deliveryCheckoutId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
}): Promise<
  | {
      ok: true;
      delivery_request_id: string;
      already_paid?: boolean;
      created?: boolean;
    }
  | { ok: false; error: string }
> {
  const { supabaseAdmin, deliveryCheckoutId } = params;

  const { data: intent, error: intentErr } = await supabaseAdmin
    .from("delivery_checkout_intents")
    .select("*")
    .eq("id", deliveryCheckoutId)
    .maybeSingle();

  if (intentErr) return { ok: false, error: intentErr.message };
  if (!intent) return { ok: false, error: "delivery_checkout_not_found" };

  if (intent.delivery_request_id) {
    return {
      ok: true,
      delivery_request_id: String(intent.delivery_request_id),
      already_paid: true,
      created: false,
    };
  }

  if (new Date(String(intent.expires_at)).getTime() < Date.now()) {
    if (String(intent.status) !== "paid") {
      await supabaseAdmin
        .from("delivery_checkout_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", deliveryCheckoutId);
    }
    return { ok: false, error: "delivery_checkout_expired" };
  }

  const snapshot = intent.snapshot as DeliveryCheckoutIntentSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, error: "delivery_snapshot_missing" };
  }

  const amountCents = Math.round(Number(intent.amount_cents ?? 0));
  const stripeAmountCents = Math.round(Number(params.expectedAmountCents ?? 0));
  if (!stripeAmountCents) return { ok: false, error: "missing_stripe_amount" };
  const expectedStripe = toStripeAmount(String(intent.currency), amountCents);
  if (stripeAmountCents !== expectedStripe && stripeAmountCents !== amountCents) {
    return { ok: false, error: "amount_mismatch" };
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

  let created;
  try {
    created = await createDeliveryRequestServerSide({
      supabaseAdmin,
      clientId: snapshot.client_user_id,
      requestType: snapshot.request_type,
      title: snapshot.title,
      description: snapshot.description,
      pickupAddress: snapshot.pickup_address,
      dropoffAddress: snapshot.dropoff_address,
      pickupContactName: snapshot.pickup_contact_name,
      pickupPhone: snapshot.pickup_phone,
      dropoffContactName: snapshot.dropoff_contact_name,
      dropoffPhone: snapshot.dropoff_phone,
      pickupLat: snapshot.pickup_lat,
      pickupLng: snapshot.pickup_lng,
      dropoffLat: snapshot.dropoff_lat,
      dropoffLng: snapshot.dropoff_lng,
      dropoffLocationId: snapshot.dropoff_location_id,
      countryCode: snapshot.country_code,
      promoCode: snapshot.promo_code,
      leaveAtDoor: snapshot.leave_at_door === true,
      settlePaid: {
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      },
    });
  } catch (e: unknown) {
    const { data: again } = await supabaseAdmin
      .from("delivery_checkout_intents")
      .select("delivery_request_id")
      .eq("id", deliveryCheckoutId)
      .maybeSingle();
    if (again?.delivery_request_id) {
      return {
        ok: true,
        delivery_request_id: String(again.delivery_request_id),
        already_paid: true,
        created: false,
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "delivery_insert_failed",
    };
  }

  const deliveryRequestId = created.deliveryRequestId;

  await supabaseAdmin
    .from("delivery_checkout_intents")
    .update({
      status: "paid",
      delivery_request_id: deliveryRequestId,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryCheckoutId);

  if (paymentIntentId) {
    try {
      const { data: row } = await supabaseAdmin
        .from("delivery_requests")
        .select(
          "id,total_cents,total,currency,client_user_id,created_by,stripe_payment_intent_id",
        )
        .eq("id", deliveryRequestId)
        .maybeSingle();
      if (row) {
        await bridgeStripeWalletFromPaidDeliveryRequest(supabaseAdmin, {
          paymentIntentId,
          deliveryRequest: row,
          source: params.source,
        });
      }
    } catch (e) {
      console.warn("[delivery quote-checkout] wallet bridge", e);
    }
  }

  try {
    await captureEntityCredit(supabaseAdmin, "delivery_request", deliveryRequestId);
  } catch (e) {
    console.warn("[delivery quote-checkout] credit capture", e);
  }

  try {
    const { captureEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await captureEntityMarketing(supabaseAdmin, "delivery", deliveryRequestId);
  } catch (e) {
    console.warn("[delivery quote-checkout] marketing capture", e);
  }

  try {
    await enqueuePaymentSucceeded({
      supabaseAdmin,
      entityType: "delivery_request",
      entityId: deliveryRequestId,
      vertical: "delivery",
      amountCents,
      currency: snapshot.currency,
      countryCode: inferPlatformCountryCode({
        countryCode: snapshot.country_code,
        lat: snapshot.pickup_lat,
        lng: snapshot.pickup_lng,
      }),
      paymentIntentId,
    });
  } catch (e) {
    console.warn("[delivery quote-checkout] finance enqueue", e);
  }

  await triggerDeliveryRequestDispatch({
    supabase: supabaseAdmin,
    deliveryRequestId,
    wave: 1,
  });

  return { ok: true, delivery_request_id: deliveryRequestId, created: true };
}

export async function resolveDeliveryQuoteCheckoutPayment(params: {
  supabaseAdmin: SupabaseClient;
  metadata?: Record<string, unknown> | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
}): Promise<
  | { ok: true; delivery_request_id: string; already_paid?: boolean }
  | { ok: false; error: string; ignored?: boolean }
> {
  const deliveryCheckoutId = pickDeliveryQuoteCheckoutId(params.metadata);
  if (!deliveryCheckoutId) {
    return { ok: false, error: "missing_delivery_checkout_id", ignored: true };
  }
  return materializePaidDeliveryRequestFromQuoteCheckout({
    supabaseAdmin: params.supabaseAdmin,
    deliveryCheckoutId,
    sessionId: params.sessionId,
    paymentIntentId: params.paymentIntentId,
    expectedAmountCents: params.expectedAmountCents,
    source: params.source,
    paymentIntent: params.paymentIntent,
  });
}
