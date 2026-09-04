import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  refundEntityCredit,
  reverseEntityLoyalty,
  type CreditEntityType,
} from "@/lib/loyalty/loyaltyCredit";
import { reverseInboundPaymentWalletEntries } from "@/lib/inboundWalletBridge";
import { getPaymentTransactionByExternalReference } from "@/lib/paymentTransactionService";
import type { PaymentTransactionRow } from "@/lib/paymentTypes";

type RefundableTable =
  | "orders"
  | "delivery_requests"
  | "taxi_rides"
  | "seller_orders";

const CREDIT_ENTITY_BY_TABLE: Partial<Record<RefundableTable, CreditEntityType>> = {
  orders: "food_order",
  delivery_requests: "delivery_request",
  taxi_rides: "taxi_ride",
};

type RefundSyncResult = {
  updated: string[];
  skipped: string[];
  clawback?: {
    attempted: number;
    reversed: string[];
    failed: string[];
    reconcile_required: boolean;
  };
};

function paymentIntentIdFromCharge(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent;
  if (typeof pi === "string" && pi.trim()) return pi.trim();
  if (pi && typeof pi === "object" && "id" in pi && typeof pi.id === "string") {
    return pi.id.trim();
  }
  return null;
}

function primaryRefundId(charge: Stripe.Charge): string | null {
  const refund = charge.refunds?.data?.[0];
  return typeof refund?.id === "string" && refund.id.trim() ? refund.id.trim() : null;
}

function refundAmountCentsFromCharge(charge: Stripe.Charge): number {
  const fromRefund = Number(charge.refunds?.data?.[0]?.amount ?? 0);
  if (Number.isFinite(fromRefund) && fromRefund > 0) return Math.round(fromRefund);
  const total = Number(charge.amount_refunded ?? 0);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
}

function marketingKind(
  table: RefundableTable
): "food" | "delivery" | "taxi" | "marketplace" {
  if (table === "orders") return "food";
  if (table === "delivery_requests") return "delivery";
  if (table === "taxi_rides") return "taxi";
  return "marketplace";
}

function financeVertical(
  table: RefundableTable
): "food" | "delivery" | "taxi" | "marketplace" {
  return marketingKind(table);
}

function financeEntityType(table: RefundableTable): string {
  if (table === "orders") return "food_order";
  if (table === "delivery_requests") return "delivery_request";
  if (table === "taxi_rides") return "taxi_ride";
  return "seller_order";
}

function clawbackEntityType(
  table: Exclude<RefundableTable, "seller_orders">
): "food_order" | "delivery_request" | "taxi_ride" {
  if (table === "orders") return "food_order";
  if (table === "delivery_requests") return "delivery_request";
  return "taxi_ride";
}

async function tryReverseInboundWallet(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  refundId: string | null,
  amountCents: number
): Promise<void> {
  if (!refundId || amountCents <= 0) return;

  let transaction: PaymentTransactionRow | null = null;
  try {
    transaction = await getPaymentTransactionByExternalReference(
      supabaseAdmin,
      "stripe",
      paymentIntentId
    );
  } catch (e) {
    console.warn(
      "[wallet] refund reverse lookup fail-open",
      e instanceof Error ? e.message : e
    );
    return;
  }

  if (!transaction) return;

  try {
    await reverseInboundPaymentWalletEntries(supabaseAdmin, {
      transaction,
      refundId,
      amountCents,
    });
  } catch (e) {
    console.warn(
      "[wallet] reverse_inbound_payment_wallet_entries fail-open",
      e instanceof Error ? e.message : e
    );
  }
}

async function runPartnerClawbackForTable(params: {
  supabaseAdmin: SupabaseClient;
  table: RefundableTable;
  entityId: string;
  refundId: string | null;
}): Promise<{
  attempted: number;
  reversed: string[];
  failed: string[];
  reconcile_required: boolean;
}> {
  if (params.table === "seller_orders") {
    try {
      const {
        cancelOpenMarketplacePayouts,
        reversePaidMarketplaceTransfers,
      } = await import("@/lib/marketplaceRefundService");
      await cancelOpenMarketplacePayouts(params.supabaseAdmin, params.entityId);
      const reversals = await reversePaidMarketplaceTransfers(
        params.supabaseAdmin,
        params.entityId,
        `stripe_webhook_refund:${params.refundId ?? params.entityId}`
      );
      return {
        attempted: reversals.reversed.length + reversals.failed.length,
        reversed: reversals.reversed,
        failed: reversals.failed,
        reconcile_required: reversals.failed.length > 0,
      };
    } catch (e) {
      console.error(
        "[marketplace] refund clawback failed",
        e instanceof Error ? e.message : e
      );
      return {
        attempted: 0,
        reversed: [],
        failed: [],
        reconcile_required: true,
      };
    }
  }

  try {
    const { clawbackPartnerTransfersForRefund } = await import(
      "@/lib/finance/partnerTransferClawback"
    );
    const result = await clawbackPartnerTransfersForRefund({
      supabaseAdmin: params.supabaseAdmin,
      entityType: clawbackEntityType(params.table),
      entityId: params.entityId,
      refundId: params.refundId,
      reason: `stripe_webhook_refund:${params.refundId ?? params.entityId}`,
    });
    if (result.reconcile_required) {
      console.error("[partner-clawback] reconcile_required after refund", {
        table: params.table,
        entityId: params.entityId,
        failed: result.failed,
      });
    }
    return {
      attempted: result.attempted,
      reversed: result.reversed,
      failed: result.failed,
      reconcile_required: result.reconcile_required,
    };
  } catch (e) {
    console.error(
      "[partner-clawback] refund clawback threw",
      params.table,
      e instanceof Error ? e.message : e
    );
    return {
      attempted: 0,
      reversed: [],
      failed: [],
      reconcile_required: true,
    };
  }
}

async function markRefundedByPaymentIntent(
  supabaseAdmin: SupabaseClient,
  table: RefundableTable,
  paymentIntentId: string,
  refundId: string | null,
  refundedAt: string,
  amountCents: number,
): Promise<{
  updated: string[];
  clawback: {
    attempted: number;
    reversed: string[];
    failed: string[];
    reconcile_required: boolean;
  };
}> {
  const { data: rows, error } = await supabaseAdmin
    .from(table)
    .select("id, stripe_refund_id, refund_status, payment_status, currency")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(20);

  if (error) {
    throw new Error(`${table} refund lookup failed: ${error.message}`);
  }

  const updated: string[] = [];
  const clawbackAgg = {
    attempted: 0,
    reversed: [] as string[],
    failed: [] as string[],
    reconcile_required: false,
  };

  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;

    const existingRefundId = String(
      (row as { stripe_refund_id?: string | null }).stripe_refund_id ?? "",
    ).trim();

    // Idempotent mark: skip DB patch when already stamped with this refund
    // (or any refund id). Always re-run clawback — Stripe reverse is
    // idempotent and failed recoveries must be re-attempted / re-recorded.
    const needsMark = !existingRefundId;

    if (needsMark) {
      const patch: Record<string, unknown> = {
        refund_status: "refunded",
        stripe_refund_id: refundId,
        stripe_refunded_at: refundedAt,
      };

      // seller_orders payment_status check may not include "refunded" — keep paid + refund_status.
      if (table !== "seller_orders") {
        patch.payment_status = "refunded";
      }

      const { error: updateError } = await supabaseAdmin
        .from(table)
        .update(patch)
        .eq("id", id);

      if (updateError) {
        throw new Error(`${table} refund update failed: ${updateError.message}`);
      }

      const refundRef = String(refundId ?? paymentIntentId);
      const creditEntity = CREDIT_ENTITY_BY_TABLE[table];

      if (creditEntity) {
        try {
          await refundEntityCredit(supabaseAdmin, creditEntity, id, refundRef);
          await reverseEntityLoyalty(
            supabaseAdmin,
            creditEntity,
            id,
            `Remboursement Stripe (${refundRef})`,
          );
        } catch (e) {
          console.warn(
            "[loyalty] refund reverse fail-open",
            table,
            e instanceof Error ? e.message : e
          );
        }
      }

      try {
        const { reverseEntityMarketing } = await import(
          "@/lib/marketing/marketingCheckoutLifecycle"
        );
        await reverseEntityMarketing(supabaseAdmin, marketingKind(table), id, {
          reason: `stripe_refund:${refundRef}`,
          restoreCoupon: true,
          refundId: refundRef,
        });
      } catch (e) {
        console.warn(
          "[marketing] reverse on refund fail-open",
          e instanceof Error ? e.message : e
        );
      }

      try {
        const { enqueueRefundEvent } = await import("@/lib/finance/financeEvents");
        void enqueueRefundEvent({
          supabaseAdmin,
          entityType: financeEntityType(table),
          entityId: id,
          vertical: financeVertical(table),
          amountCents,
          currency: String((row as { currency?: string | null }).currency ?? "USD"),
          refundId: refundRef,
        });
      } catch (e) {
        console.warn(
          "[finance] refund enqueue fail-open",
          e instanceof Error ? e.message : e
        );
      }

      updated.push(id);
    }

    const claw = await runPartnerClawbackForTable({
      supabaseAdmin,
      table,
      entityId: id,
      refundId,
    });
    clawbackAgg.attempted += claw.attempted;
    clawbackAgg.reversed.push(...claw.reversed);
    clawbackAgg.failed.push(...claw.failed);
    clawbackAgg.reconcile_required =
      clawbackAgg.reconcile_required || claw.reconcile_required;
  }

  return { updated, clawback: clawbackAgg };
}

async function markAllRefundableTables(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  refundId: string | null,
  refundedAt: string,
  amountCents: number,
): Promise<{
  updated: string[];
  clawback: {
    attempted: number;
    reversed: string[];
    failed: string[];
    reconcile_required: boolean;
  };
}> {
  const tables: RefundableTable[] = [
    "orders",
    "delivery_requests",
    "taxi_rides",
    "seller_orders",
  ];
  const updated: string[] = [];
  const clawback = {
    attempted: 0,
    reversed: [] as string[],
    failed: [] as string[],
    reconcile_required: false,
  };

  for (const table of tables) {
    const result = await markRefundedByPaymentIntent(
      supabaseAdmin,
      table,
      paymentIntentId,
      refundId,
      refundedAt,
      amountCents,
    );
    updated.push(...result.updated);
    clawback.attempted += result.clawback.attempted;
    clawback.reversed.push(...result.clawback.reversed);
    clawback.failed.push(...result.clawback.failed);
    clawback.reconcile_required =
      clawback.reconcile_required || result.clawback.reconcile_required;
  }

  // Tip PI refunds do not match primary stripe_payment_intent_id rows.
  try {
    const { clawbackTipTransfersForRefund } = await import(
      "@/lib/finance/partnerTransferClawback"
    );
    const tipResult = await clawbackTipTransfersForRefund({
      supabaseAdmin,
      paymentIntentId,
      refundId,
      reason: `stripe_tip_refund:${refundId ?? paymentIntentId}`,
    });
    clawback.attempted += tipResult.attempted;
    clawback.reversed.push(...tipResult.reversed);
    clawback.failed.push(...tipResult.failed);
    clawback.reconcile_required =
      clawback.reconcile_required || tipResult.reconcile_required;
    if (tipResult.attempted > 0 && tipResult.reversed.length > 0) {
      updated.push(`tip_clawback:${paymentIntentId}`);
    }
  } catch (e) {
    console.error(
      "[partner-clawback] tip refund path failed",
      e instanceof Error ? e.message : e
    );
    clawback.reconcile_required = true;
  }

  return { updated, clawback };
}

export async function syncStripeChargeRefunded(params: {
  supabaseAdmin: SupabaseClient;
  charge: Stripe.Charge;
}): Promise<RefundSyncResult> {
  const paymentIntentId = paymentIntentIdFromCharge(params.charge);
  if (!paymentIntentId) {
    return { updated: [], skipped: ["missing_payment_intent"] };
  }

  const refundId = primaryRefundId(params.charge);
  const refundedAt = new Date(
    (params.charge.refunds?.data?.[0]?.created ?? params.charge.created) * 1000,
  ).toISOString();
  const amountCents = refundAmountCentsFromCharge(params.charge);

  const { updated, clawback } = await markAllRefundableTables(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    refundedAt,
    amountCents,
  );

  // After entity mark: reverse inbound wallet entries (fail-open).
  await tryReverseInboundWallet(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    amountCents
  );

  if (updated.length === 0 && clawback.attempted === 0) {
    return { updated: [], skipped: ["no_matching_rows"], clawback };
  }

  return { updated, skipped: [], clawback };
}

export async function syncStripeRefundObject(params: {
  supabaseAdmin: SupabaseClient;
  refund: Stripe.Refund;
}): Promise<RefundSyncResult> {
  const paymentIntentId =
    typeof params.refund.payment_intent === "string"
      ? params.refund.payment_intent.trim()
      : null;

  if (!paymentIntentId) {
    return { updated: [], skipped: ["missing_payment_intent"] };
  }

  const refundedAt = new Date(params.refund.created * 1000).toISOString();
  const refundId = String(params.refund.id ?? "").trim() || null;
  const amountCents = Math.max(0, Math.round(Number(params.refund.amount ?? 0)));

  const { updated, clawback } = await markAllRefundableTables(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    refundedAt,
    amountCents,
  );

  await tryReverseInboundWallet(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    amountCents
  );

  if (updated.length === 0 && clawback.attempted === 0) {
    return { updated: [], skipped: ["no_matching_rows"], clawback };
  }

  return { updated, skipped: [], clawback };
}
