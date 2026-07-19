import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { isMarketplaceCheckoutLiveEnabled } from "@/lib/marketplaceLiveCheckout";
import { prepareMarketplaceDeliveryJobAfterPayment } from "@/lib/marketplaceDispatchService";
import { prepareMarketplaceSellerPayoutAfterPayment } from "@/lib/marketplacePayoutService";
import { notifyMarketplaceSellerNewPaidOrder } from "@/lib/marketplacePushNotifications";
import { awardMarketplaceOrderLoyalty } from "@/lib/loyalty/loyaltyAccrual";
import { awardSellerOrderPerformance } from "@/lib/loyalty/marketplaceLoyaltyHooks";
import {
  requirePaymentIntentSucceeded,
  assertSettlementMatchesExpectation,
} from "@/lib/requirePaymentIntentSucceeded";

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
  metadata?: Record<string, unknown> | null;
  paymentIntent?: Stripe.PaymentIntent | null;
  session?: Stripe.Checkout.Session | null;
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

  // Single source of truth: never mark a seller_order paid on session status
  // alone — require the underlying PaymentIntent to have actually succeeded and
  // to carry the expected marketplace business identity (strict for versioned
  // PIs, tolerant for historical ones).
  const settled = await requirePaymentIntentSucceeded({
    paymentIntentId: paymentIntentId ?? row.stripe_payment_intent_id ?? null,
    sessionId: sessionId ?? row.stripe_checkout_session_id ?? null,
    paymentIntent: params.paymentIntent ?? undefined,
    session: params.session ?? undefined,
  });
  if (!settled.ok) {
    return { ok: false, error: `payment_intent_not_succeeded:${settled.reason}` };
  }

  const metadata = params.metadata ?? settled.metadata ?? null;
  const expectation = assertSettlementMatchesExpectation(settled, metadata, {
    userIds: [row.client_user_id],
    serviceType: "marketplace",
    entityId: sellerOrderId,
    entityIdKeys: ["seller_order_id", "sellerOrderId", "order_id"],
  });
  if (!expectation.ok) {
    return {
      ok: false,
      error: `payment_expectation_${expectation.field}:${expectation.reason}`,
    };
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

  void awardMarketplaceOrderLoyalty(supabaseAdmin, sellerOrderId);
  void awardSellerOrderPerformance(supabaseAdmin, sellerOrderId);

  void (async () => {
    try {
      const { captureEntityMarketing } = await import(
        "@/lib/marketing/marketingCheckoutLifecycle"
      );
      await captureEntityMarketing(supabaseAdmin, "marketplace", sellerOrderId);
    } catch (e) {
      console.warn(
        "[marketing] marketplace stripe capture fail-open",
        e instanceof Error ? e.message : e
      );
    }
  })();

  void (async () => {
    try {
      const { data: seller } = await supabaseAdmin
        .from("sellers")
        .select("user_id")
        .eq("id", row.seller_id)
        .maybeSingle();
      if (seller?.user_id) {
        await notifyMarketplaceSellerNewPaidOrder({
          supabaseAdmin,
          sellerUserId: String(seller.user_id),
          orderId: sellerOrderId,
        });
      }
    } catch (notifyError) {
      console.warn(
        "[marketplace-stripe-webhook] seller notify failed:",
        notifyError instanceof Error ? notifyError.message : notifyError
      );
    }
  })();

  return { ok: true };
}

export async function handleMarketplaceCheckoutSessionExpired(params: {
  supabaseAdmin: SupabaseClient;
  sellerOrderId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  source: string;
}): Promise<{
  ok: boolean;
  ignored?: string;
  error?: string;
  sync?: { updated: string[]; skipped: string[] };
}> {
  if (!isMarketplaceCheckoutLiveEnabled()) {
    return { ok: true, ignored: "marketplace_live_checkout_disabled" };
  }

  const { supabaseAdmin, sellerOrderId, sessionId, paymentIntentId, source } =
    params;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,payment_status,status,stripe_checkout_session_id,stripe_payment_intent_id"
    )
    .eq("id", sellerOrderId)
    .maybeSingle();

  if (orderError) return { ok: false, error: orderError.message };
  if (!order) return { ok: false, error: "seller_order_not_found" };

  const row = order as SellerOrderPaymentRow & {
    stripe_checkout_session_id?: string | null;
  };

  if (row.payment_status === "paid" || row.status === "paid") {
    return {
      ok: true,
      ignored: "already_paid",
      sync: { updated: [], skipped: ["already_paid"] },
    };
  }

  if (
    row.stripe_checkout_session_id &&
    sessionId &&
    row.stripe_checkout_session_id !== sessionId
  ) {
    return {
      ok: true,
      ignored: "session_mismatch",
      sync: { updated: [], skipped: ["session_mismatch"] },
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "pending_checkout",
      payment_status: "pending",
      stripe_checkout_session_id: sessionId ?? row.stripe_checkout_session_id,
      stripe_payment_intent_id:
        paymentIntentId ?? row.stripe_payment_intent_id ?? null,
      updated_at: nowIso,
    })
    .eq("id", sellerOrderId)
    .neq("payment_status", "paid")
    .in("status", ["pending_payment", "pending_checkout"])
    .select("id")
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };

  if (!updated) {
    return {
      ok: true,
      ignored: "update_noop",
      sync: { updated: [], skipped: ["update_noop"] },
    };
  }

  console.log("[marketplace-stripe-webhook] seller_order checkout expired", {
    sellerOrderId,
    sessionId,
    paymentIntentId,
    source,
  });

  try {
    const { releaseEntityMarketing } = await import(
      "@/lib/marketing/marketingCheckoutLifecycle"
    );
    await releaseEntityMarketing(
      supabaseAdmin,
      "marketplace",
      sellerOrderId,
      "checkout_session_expired"
    );
  } catch (e) {
    console.warn(
      "[marketing] marketplace release fail-open",
      e instanceof Error ? e.message : e
    );
  }

  return {
    ok: true,
    sync: { updated: [sellerOrderId], skipped: [] },
  };
}

export async function handleMarketplaceStripePaymentFailed(params: {
  supabaseAdmin: SupabaseClient;
  sellerOrderId: string;
  paymentIntentId?: string | null;
  source: string;
}): Promise<{
  ok: boolean;
  ignored?: string;
  error?: string;
  sync?: { updated: string[]; skipped: string[] };
}> {
  if (!isMarketplaceCheckoutLiveEnabled()) {
    return { ok: true, ignored: "marketplace_live_checkout_disabled" };
  }

  const { supabaseAdmin, sellerOrderId, paymentIntentId, source } = params;

  const { data: updated, error } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "payment_failed",
      payment_status: "failed",
      stripe_payment_intent_id: paymentIntentId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sellerOrderId)
    .in("status", ["pending_payment", "pending_checkout"])
    .neq("payment_status", "paid")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  if (!updated) {
    return {
      ok: true,
      ignored: "update_noop",
      sync: { updated: [], skipped: ["update_noop"] },
    };
  }

  console.log("[marketplace-stripe-webhook] seller_order marked payment_failed", {
    sellerOrderId,
    paymentIntentId,
    source,
  });

  return {
    ok: true,
    sync: { updated: [sellerOrderId], skipped: [] },
  };
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
