import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { isMarketplaceCheckoutLiveEnabled } from "@/lib/marketplaceLiveCheckout";
import { prepareMarketplaceDeliveryJobAfterPayment } from "@/lib/marketplaceDispatchService";
import { prepareMarketplaceSellerPayoutAfterPayment } from "@/lib/marketplacePayoutService";

type SellerOrderPaymentRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  payment_status: string | null;
  total_cents: number;
  currency: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
};

export function isMarketplaceStripeModule(
  md: Record<string, unknown> | null | undefined
): boolean {
  return String(md?.module ?? "").trim().toLowerCase() === "marketplace";
}

export function pickSellerOrderIdFromMetadata(
  md: Record<string, unknown> | null | undefined
): string | null {
  if (!isMarketplaceStripeModule(md)) return null;

  const raw = md?.seller_order_id ?? md?.sellerOrderId ?? md?.order_id ?? null;
  if (!raw) return null;
  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCurrency(value: unknown): string {
  return String(value ?? "USD")
    .trim()
    .toLowerCase();
}

function isCheckoutSessionPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid";
}

export async function handleMarketplaceStripePayment(params: {
  supabaseAdmin: SupabaseClient;
  sellerOrderId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  expectedAmountCents?: number | null;
  expectedCurrency?: string | null;
  source: string;
}): Promise<{ ok: boolean; already_paid?: boolean; ignored?: string; error?: string }> {
  if (!isMarketplaceCheckoutLiveEnabled()) {
    return {
      ok: true,
      ignored: "marketplace_live_checkout_disabled",
    };
  }

  const { supabaseAdmin, sellerOrderId, sessionId, paymentIntentId, source } = params;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,seller_id,client_user_id,status,payment_status,total_cents,currency,stripe_checkout_session_id,stripe_payment_intent_id,paid_at"
    )
    .eq("id", sellerOrderId)
    .maybeSingle();

  if (orderError) return { ok: false, error: orderError.message };
  if (!order) return { ok: false, error: "seller_order_not_found" };

  const row = order as SellerOrderPaymentRow;

  if (row.payment_status === "paid" || row.status === "paid") {
    return { ok: true, already_paid: true };
  }

  if (
    params.expectedAmountCents != null &&
    Number(row.total_cents) !== Number(params.expectedAmountCents)
  ) {
    return { ok: false, error: "amount_mismatch" };
  }

  if (
    params.expectedCurrency &&
    normalizeCurrency(row.currency) !== normalizeCurrency(params.expectedCurrency)
  ) {
    return { ok: false, error: "currency_mismatch" };
  }

  if (
    sessionId &&
    row.stripe_checkout_session_id &&
    row.stripe_checkout_session_id !== sessionId
  ) {
    return { ok: false, error: "session_mismatch" };
  }

  const paidAt = new Date().toISOString();

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "paid",
      payment_status: "paid",
      paid_at: paidAt,
      stripe_checkout_session_id: sessionId ?? row.stripe_checkout_session_id,
      stripe_payment_intent_id: paymentIntentId ?? row.stripe_payment_intent_id,
      updated_at: paidAt,
    })
    .eq("id", sellerOrderId)
    .neq("payment_status", "paid")
    .select("id,payment_status,status")
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };

  if (!updated) {
    return { ok: true, already_paid: true };
  }

  console.log("[marketplace-stripe-webhook] seller_order marked paid", {
    sellerOrderId,
    sessionId,
    paymentIntentId,
    source,
  });

  void prepareMarketplaceDeliveryJobAfterPayment(supabaseAdmin, {
    sellerOrderId,
    source: `stripe_webhook:${source}`,
  }).catch((dispatchError) => {
    console.warn(
      "[marketplace-stripe-webhook] dispatch job prep failed:",
      dispatchError instanceof Error ? dispatchError.message : dispatchError
    );
  });

  void prepareMarketplaceSellerPayoutAfterPayment(supabaseAdmin, {
    sellerOrderId,
    source: `stripe_webhook:${source}`,
  }).catch((payoutError) => {
    console.warn(
      "[marketplace-stripe-webhook] seller payout prep failed:",
      payoutError instanceof Error ? payoutError.message : payoutError
    );
  });

  return { ok: true };
}

export async function handleMarketplaceStripePaymentFailed(params: {
  supabaseAdmin: SupabaseClient;
  sellerOrderId: string;
  paymentIntentId?: string | null;
  source: string;
}): Promise<{ ok: boolean; ignored?: string; error?: string }> {
  if (!isMarketplaceCheckoutLiveEnabled()) {
    return { ok: true, ignored: "marketplace_live_checkout_disabled" };
  }

  const { supabaseAdmin, sellerOrderId, paymentIntentId, source } = params;

  const { error } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "payment_failed",
      payment_status: "failed",
      stripe_payment_intent_id: paymentIntentId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sellerOrderId)
    .in("status", ["pending_payment", "pending_checkout"])
    .neq("payment_status", "paid");

  if (error) return { ok: false, error: error.message };

  console.log("[marketplace-stripe-webhook] seller_order marked payment_failed", {
    sellerOrderId,
    paymentIntentId,
    source,
  });

  return { ok: true };
}

export function getMarketplaceStripeAmountFromCheckoutSession(
  session: Stripe.Checkout.Session
): number | null {
  const amount = Number(session.amount_total);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function getMarketplaceStripeAmountFromPaymentIntent(
  pi: Stripe.PaymentIntent
): number | null {
  const amount = Number(pi.amount_received || pi.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export { isCheckoutSessionPaid as isMarketplaceCheckoutSessionPaid };
