import type { SupabaseClient } from "@supabase/supabase-js";
import { completeFoodOrderAfterPayment } from "@/lib/foodOrderPaymentCompletion";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import { bridgeStripeWalletFromPaidOrder } from "@/lib/stripeInboundWalletBridge";
import { ensureOrderCommissionsReady } from "@/lib/refreshOrderCommissions";

/**
 * Idempotent post mark_order_paid side-effects for food Stripe settlement:
 * wallet bridge, commissions, food completion, finance food_paid enqueue.
 */
export async function finalizeFoodStripeSettlementAfterMarkPaid(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  paymentIntentId: string;
  sessionId?: string | null;
  order: {
    id: string;
    kind?: string | null;
    client_user_id?: string | null;
    created_by?: string | null;
    user_id?: string | null;
    total_cents?: number | null;
    total?: number | null;
    grand_total?: number | null;
    currency?: string | null;
    pickup_lat?: number | null;
    pickup_lng?: number | null;
    dropoff_lat?: number | null;
    dropoff_lng?: number | null;
  };
  source: string;
  dispatchOrigin?: string | null;
  runWalletBridge?: boolean;
  processFinanceBatch?: boolean;
}): Promise<{
  ok: true;
  wallet?: { ok: true; created: boolean } | { ok: false; error: string };
  finance?: Record<string, unknown>;
  finance_batch?: Record<string, unknown>;
}> {
  const { supabaseAdmin, orderId, paymentIntentId, order } = params;

  let wallet:
    | { ok: true; created: boolean }
    | { ok: false; error: string }
    | undefined;

  if (params.runWalletBridge !== false) {
    const bridge = await bridgeStripeWalletFromPaidOrder(supabaseAdmin, {
      paymentIntentId,
      order,
      source: params.source,
      countryCode: resolveOrderPlatformCountry(order),
    });
    if (bridge.ok === false) {
      wallet = { ok: false, error: bridge.error };
    } else {
      wallet = { ok: true, created: bridge.created };
    }
  }

  await ensureOrderCommissionsReady(supabaseAdmin, orderId, params.source);

  if (String(order.kind ?? "").toLowerCase() === "food") {
    await completeFoodOrderAfterPayment(supabaseAdmin, {
      orderId,
      clientUserIds: [order.client_user_id, order.created_by, order.user_id],
      kind: order.kind,
      dispatchOrigin: params.dispatchOrigin ?? null,
    });
  }

  const { enqueuePaymentSucceeded, processFinancePendingBatch } = await import(
    "@/lib/finance/financeEvents"
  );
  const finance = await enqueuePaymentSucceeded({
    supabaseAdmin,
    entityType: "order",
    entityId: orderId,
    vertical: "food",
    amountCents: Number(order.total_cents ?? 0),
    currency: order.currency ?? "USD",
    countryCode: resolveOrderPlatformCountry(order),
    paymentIntentId,
  });

  let finance_batch: Record<string, unknown> | undefined;
  if (params.processFinanceBatch) {
    finance_batch = await processFinancePendingBatch(supabaseAdmin, 50);
  }

  return { ok: true, wallet, finance, finance_batch };
}
