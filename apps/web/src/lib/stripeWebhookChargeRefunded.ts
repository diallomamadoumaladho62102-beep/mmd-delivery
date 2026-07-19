import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  refundEntityCredit,
  reverseEntityLoyalty,
  type CreditEntityType,
} from "@/lib/loyalty/loyaltyCredit";

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

async function markRefundedByPaymentIntent(
  supabaseAdmin: SupabaseClient,
  table: RefundableTable,
  paymentIntentId: string,
  refundId: string | null,
  refundedAt: string,
  amountCents: number,
): Promise<string[]> {
  const { data: rows, error } = await supabaseAdmin
    .from(table)
    .select("id, stripe_refund_id, refund_status, payment_status, currency")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(20);

  if (error) {
    throw new Error(`${table} refund lookup failed: ${error.message}`);
  }

  const updated: string[] = [];

  for (const row of rows ?? []) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;

    const existingRefundId = String(
      (row as { stripe_refund_id?: string | null }).stripe_refund_id ?? "",
    ).trim();
    if (existingRefundId) continue;

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

  return updated;
}

async function markAllRefundableTables(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string,
  refundId: string | null,
  refundedAt: string,
  amountCents: number,
): Promise<string[]> {
  const tables: RefundableTable[] = [
    "orders",
    "delivery_requests",
    "taxi_rides",
    "seller_orders",
  ];
  const updated: string[] = [];
  for (const table of tables) {
    updated.push(
      ...(await markRefundedByPaymentIntent(
        supabaseAdmin,
        table,
        paymentIntentId,
        refundId,
        refundedAt,
        amountCents,
      )),
    );
  }
  return updated;
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

  const updated = await markAllRefundableTables(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    refundedAt,
    amountCents,
  );

  if (updated.length === 0) {
    return { updated: [], skipped: ["no_matching_rows"] };
  }

  return { updated, skipped: [] };
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

  const updated = await markAllRefundableTables(
    params.supabaseAdmin,
    paymentIntentId,
    refundId,
    refundedAt,
    amountCents,
  );

  if (updated.length === 0) {
    return { updated: [], skipped: ["no_matching_rows"] };
  }

  return { updated, skipped: [] };
}
