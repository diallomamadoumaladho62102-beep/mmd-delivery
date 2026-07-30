/**
 * Food pay-then-create: quote checkout intents + materialize paid order after Stripe.
 * No orders row until PaymentIntent succeeds.
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
import {
  createFoodOrderServerSide,
  type CreateFoodOrderInput,
} from "@/lib/foodOrderService";
import { completeFoodOrderAfterPayment } from "@/lib/foodOrderPaymentCompletion";
import { enqueuePaymentSucceeded } from "@/lib/finance/financeEvents";
import { bridgeStripeWalletFromPaidOrder } from "@/lib/stripeInboundWalletBridge";
import type { FoodOrderLineInput } from "@/lib/foodOrderServerPricing";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export const FOOD_QUOTE_CHECKOUT_TTL_MS = 30 * 60 * 1000;

export type FoodCheckoutIntentSnapshot = {
  version: 1;
  client_user_id: string;
  restaurant_user_id: string;
  restaurant_name: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  items: FoodOrderLineInput[];
  country_code: string;
  promo_code?: string | null;
  leave_at_door?: boolean;
  currency: string;
  amount_cents: number;
};

export function hashFoodCheckoutSnapshot(snapshot: FoodCheckoutIntentSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function pickFoodQuoteCheckoutId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const raw =
    metadata.food_checkout_id ??
    metadata.foodCheckoutId ??
    metadata.quote_checkout_id ??
    null;
  const id = String(raw ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function createFoodCheckoutIntent(params: {
  supabaseAdmin: SupabaseClient;
  snapshot: FoodCheckoutIntentSnapshot;
}): Promise<{ ok: true; intentId: string } | { ok: false; error: string }> {
  const { data, error } = await params.supabaseAdmin
    .from("food_checkout_intents")
    .insert({
      client_user_id: params.snapshot.client_user_id,
      status: "pending",
      currency: params.snapshot.currency,
      amount_cents: params.snapshot.amount_cents,
      quote_hash: hashFoodCheckoutSnapshot(params.snapshot),
      snapshot: params.snapshot,
      expires_at: new Date(Date.now() + FOOD_QUOTE_CHECKOUT_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    return { ok: false, error: error?.message ?? "intent_insert_failed" };
  }
  return { ok: true, intentId: String(data.id) };
}

export async function openFoodQuoteCheckoutSession(params: {
  supabaseAdmin: SupabaseClient;
  intentId: string;
  userId: string;
  userEmail?: string | null;
  snapshot: FoodCheckoutIntentSnapshot;
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
    successQuery: { foodCheckoutId: params.intentId },
    cancelQuery: { foodCheckoutId: params.intentId },
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
              name: "MMD Food Order",
              description: `${params.snapshot.restaurant_name} · ${(amountCents / 100).toFixed(2)} ${currency}`,
            },
          },
        },
      ],
      success_url: urls.successUrl,
      cancel_url: urls.cancelUrl,
      client_reference_id: params.intentId,
      metadata: {
        metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
        service_type: "food",
        module: "food",
        food_checkout_id: params.intentId,
        user_id: params.userId,
        amount_cents: String(amountCents),
        currency,
        source_route: "create-food-quote-checkout-session",
      },
      payment_intent_data: {
        metadata: {
          metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
          service_type: "food",
          module: "food",
          food_checkout_id: params.intentId,
          user_id: params.userId,
          amount_cents: String(amountCents),
          currency,
        },
      },
    },
    {
      idempotencyKey: `food_quote_checkout_${params.intentId}_${amountCents}_${currency}`,
    },
  );

  if (!session.url || !session.id) {
    return { ok: false, error: "checkout_session_missing_url", status: 500 };
  }

  await params.supabaseAdmin
    .from("food_checkout_intents")
    .update({
      status: "checkout_open",
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.intentId);

  return { ok: true, url: session.url, sessionId: session.id };
}

export async function materializePaidFoodOrderFromQuoteCheckout(params: {
  supabaseAdmin: SupabaseClient;
  foodCheckoutId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
}): Promise<
  | { ok: true; order_id: string; already_paid?: boolean; created?: boolean }
  | { ok: false; error: string }
> {
  const { supabaseAdmin, foodCheckoutId } = params;

  const { data: intent, error: intentErr } = await supabaseAdmin
    .from("food_checkout_intents")
    .select("*")
    .eq("id", foodCheckoutId)
    .maybeSingle();

  if (intentErr) return { ok: false, error: intentErr.message };
  if (!intent) return { ok: false, error: "food_checkout_not_found" };

  if (intent.order_id) {
    return {
      ok: true,
      order_id: String(intent.order_id),
      already_paid: true,
      created: false,
    };
  }

  if (new Date(String(intent.expires_at)).getTime() < Date.now()) {
    if (String(intent.status) !== "paid") {
      await supabaseAdmin
        .from("food_checkout_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", foodCheckoutId);
    }
    return { ok: false, error: "food_checkout_expired" };
  }

  const snapshot = intent.snapshot as FoodCheckoutIntentSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, error: "food_snapshot_missing" };
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
    created = await createFoodOrderServerSide({
      supabaseAdmin,
      clientId: snapshot.client_user_id,
      restaurantUserId: snapshot.restaurant_user_id,
      restaurantName: snapshot.restaurant_name,
      pickupAddress: snapshot.pickup_address,
      pickupLat: snapshot.pickup_lat,
      pickupLng: snapshot.pickup_lng,
      dropoffAddress: snapshot.dropoff_address,
      dropoffLat: snapshot.dropoff_lat,
      dropoffLng: snapshot.dropoff_lng,
      items: snapshot.items,
      countryCode: snapshot.country_code,
      promoCode: snapshot.promo_code,
      leaveAtDoor: snapshot.leave_at_door === true,
      settlePaid: {
        stripeSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
      },
    } satisfies CreateFoodOrderInput);
  } catch (e: unknown) {
    const { data: again } = await supabaseAdmin
      .from("food_checkout_intents")
      .select("order_id")
      .eq("id", foodCheckoutId)
      .maybeSingle();
    if (again?.order_id) {
      return {
        ok: true,
        order_id: String(again.order_id),
        already_paid: true,
        created: false,
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "order_insert_failed",
    };
  }

  const orderId = created.orderId;

  await supabaseAdmin
    .from("food_checkout_intents")
    .update({
      status: "paid",
      order_id: orderId,
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", foodCheckoutId);

  if (paymentIntentId) {
    try {
      const { data: orderRow } = await supabaseAdmin
        .from("orders")
        .select(
          "id,total_cents,currency,client_user_id,created_by,user_id,stripe_payment_intent_id",
        )
        .eq("id", orderId)
        .maybeSingle();
      if (orderRow) {
        await bridgeStripeWalletFromPaidOrder(supabaseAdmin, {
          paymentIntentId,
          order: orderRow,
          source: params.source,
        });
      }
    } catch (e) {
      console.warn("[food quote-checkout] wallet bridge", e);
    }
  }

  await completeFoodOrderAfterPayment(supabaseAdmin, {
    orderId,
    clientUserIds: [snapshot.client_user_id],
    kind: "food",
    dispatchOrigin: params.source,
    restaurantName: snapshot.restaurant_name,
  });

  try {
    await enqueuePaymentSucceeded({
      supabaseAdmin,
      entityType: "order",
      entityId: orderId,
      vertical: "food",
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
    console.warn("[food quote-checkout] finance enqueue", e);
  }

  return { ok: true, order_id: orderId, created: true };
}

export async function resolveFoodQuoteCheckoutPayment(params: {
  supabaseAdmin: SupabaseClient;
  metadata?: Record<string, unknown> | null;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  source: string;
  paymentIntent?: Stripe.PaymentIntent | null;
}): Promise<
  | { ok: true; order_id: string; already_paid?: boolean }
  | { ok: false; error: string; ignored?: boolean }
> {
  const foodCheckoutId = pickFoodQuoteCheckoutId(params.metadata);
  if (!foodCheckoutId) {
    return { ok: false, error: "missing_food_checkout_id", ignored: true };
  }
  return materializePaidFoodOrderFromQuoteCheckout({
    supabaseAdmin: params.supabaseAdmin,
    foodCheckoutId,
    sessionId: params.sessionId,
    paymentIntentId: params.paymentIntentId,
    expectedAmountCents: params.expectedAmountCents,
    source: params.source,
    paymentIntent: params.paymentIntent,
  });
}
