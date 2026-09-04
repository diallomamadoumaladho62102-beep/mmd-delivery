import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

export function marketplaceRefundBlocksPayout(
  refundStatus: string | null | undefined
): boolean {
  const r = String(refundStatus ?? "").trim().toLowerCase();
  return (
    r === "refunded" ||
    r === "partially_refunded" ||
    r === "disputed" ||
    r === "full_refund_required" ||
    r === "refund_failed"
  );
}

/**
 * Cancel unpaid marketplace payout ledgers (no Stripe transfer yet).
 */
export async function cancelOpenMarketplacePayouts(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<void> {
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("marketplace_seller_payouts")
    .update({ status: "cancelled", updated_at: now })
    .eq("seller_order_id", sellerOrderId)
    .in("status", ["pending", "approved", "failed"])
    .is("stripe_transfer_id", null);

  await supabaseAdmin
    .from("marketplace_driver_payouts")
    .update({ status: "cancelled", updated_at: now })
    .eq("seller_order_id", sellerOrderId)
    .in("status", ["pending", "approved", "failed"])
    .is("stripe_transfer_id", null);
}

/**
 * Reverse already-paid marketplace SCTs (seller + driver) after customer refund.
 * Mirrors dispute clawback via transfers.createReversal.
 */
export async function reversePaidMarketplaceTransfers(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string,
  reason: string
): Promise<{ reversed: string[]; failed: string[] }> {
  const reversed: string[] = [];
  const failed: string[] = [];

  const [{ data: sellerPayouts }, { data: driverPayouts }] = await Promise.all([
    supabaseAdmin
      .from("marketplace_seller_payouts")
      .select("id,stripe_transfer_id,status")
      .eq("seller_order_id", sellerOrderId)
      .not("stripe_transfer_id", "is", null),
    supabaseAdmin
      .from("marketplace_driver_payouts")
      .select("id,stripe_transfer_id,status")
      .eq("seller_order_id", sellerOrderId)
      .not("stripe_transfer_id", "is", null),
  ]);

  const rows: Array<{
    table: "marketplace_seller_payouts" | "marketplace_driver_payouts";
    id: string;
    transferId: string;
  }> = [];

  for (const row of sellerPayouts ?? []) {
    const transferId = String(
      (row as { stripe_transfer_id?: string | null }).stripe_transfer_id ?? ""
    ).trim();
    if (transferId) {
      rows.push({
        table: "marketplace_seller_payouts",
        id: String((row as { id: string }).id),
        transferId,
      });
    }
  }
  for (const row of driverPayouts ?? []) {
    const transferId = String(
      (row as { stripe_transfer_id?: string | null }).stripe_transfer_id ?? ""
    ).trim();
    if (transferId) {
      rows.push({
        table: "marketplace_driver_payouts",
        id: String((row as { id: string }).id),
        transferId,
      });
    }
  }

  for (const row of rows) {
    try {
      await stripe.transfers.createReversal(
        row.transferId,
        {
          metadata: {
            seller_order_id: sellerOrderId,
            reason,
            source: "marketplace_refund_clawback",
          },
        },
        { idempotencyKey: `mkt_refund_rev_${sellerOrderId}_${row.transferId}` }
      );
      await supabaseAdmin
        .from(row.table)
        .update({
          status: "cancelled",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      reversed.push(row.transferId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[marketplace-refund] transfer reversal failed", {
        sellerOrderId,
        transferId: row.transferId,
        message,
      });
      failed.push(row.transferId);
      try {
        const { recordFailedTransferRecovery } = await import(
          "@/lib/finance/partnerTransferClawback"
        );
        await recordFailedTransferRecovery({
          supabaseAdmin,
          entityType: "seller_order",
          entityId: sellerOrderId,
          transferId: row.transferId,
          target: row.table === "marketplace_seller_payouts" ? "seller" : "driver",
          refundId: null,
          source: "marketplace_refund",
          correlationId: sellerOrderId,
          failureCode: "transfer_reversal_failed",
          failureMessage: message,
          reason,
        });
      } catch (recordErr) {
        console.error("[marketplace-refund] recovery record failed", {
          transferId: row.transferId,
          message:
            recordErr instanceof Error ? recordErr.message : String(recordErr),
        });
      }
    }
  }

  return { reversed, failed };
}

/**
 * Execute Stripe refund for a paid marketplace seller_order.
 * Cancels open payouts and reverses paid SCTs so money cannot leave after refund.
 */
export async function refundMarketplaceSellerOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    orderId: string;
    reason: string;
    actorRole: "client" | "seller" | "admin" | "system";
  }
): Promise<{
  ok: boolean;
  refunded: boolean;
  refundId: string | null;
  refundStatus: string;
  reversals?: { reversed: string[]; failed: string[] };
  error?: string;
}> {
  const { data: order, error: loadErr } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,payment_status,refund_status,stripe_payment_intent_id,stripe_refund_id,stripe_refunded_at"
    )
    .eq("id", params.orderId)
    .maybeSingle();

  if (loadErr) {
    return {
      ok: false,
      refunded: false,
      refundId: null,
      refundStatus: "error",
      error: loadErr.message,
    };
  }
  if (!order) {
    return {
      ok: false,
      refunded: false,
      refundId: null,
      refundStatus: "error",
      error: "order_not_found",
    };
  }

  if (
    String(order.payment_status ?? "").toLowerCase() !== "paid" &&
    !order.stripe_payment_intent_id
  ) {
    return { ok: true, refunded: false, refundId: null, refundStatus: "not_paid" };
  }

  if (order.stripe_refund_id) {
    await cancelOpenMarketplacePayouts(supabaseAdmin, params.orderId);
    const reversals = await reversePaidMarketplaceTransfers(
      supabaseAdmin,
      params.orderId,
      "already_refunded_sync"
    );
    return {
      ok: true,
      refunded: true,
      refundId: String(order.stripe_refund_id),
      refundStatus: "refunded",
      reversals,
    };
  }

  const pi = String(order.stripe_payment_intent_id ?? "").trim();
  if (!pi) {
    await supabaseAdmin
      .from("seller_orders")
      .update({ refund_status: "missing_payment_intent" })
      .eq("id", params.orderId);
    return {
      ok: false,
      refunded: false,
      refundId: null,
      refundStatus: "missing_payment_intent",
      error: "missing_payment_intent",
    };
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: pi,
        reason: "requested_by_customer",
        metadata: {
          seller_order_id: params.orderId,
          cancel_reason: params.reason,
          actor_role: params.actorRole,
          source: "marketplaceRefundService",
        },
      },
      { idempotencyKey: `mkt_refund_${params.orderId}` }
    );

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("seller_orders")
      .update({
        refund_status: "refunded",
        stripe_refund_id: refund.id,
        stripe_refunded_at: now,
        updated_at: now,
      })
      .eq("id", params.orderId);

    await cancelOpenMarketplacePayouts(supabaseAdmin, params.orderId);
    const reversals = await reversePaidMarketplaceTransfers(
      supabaseAdmin,
      params.orderId,
      params.reason
    );

    return {
      ok: true,
      refunded: true,
      refundId: refund.id,
      refundStatus: "refunded",
      reversals,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[marketplace-refund] stripe refund failed", {
      orderId: params.orderId,
      message,
    });
    await supabaseAdmin
      .from("seller_orders")
      .update({ refund_status: "refund_failed" })
      .eq("id", params.orderId);
    return {
      ok: false,
      refunded: false,
      refundId: null,
      refundStatus: "refund_failed",
      error: message,
    };
  }
}
