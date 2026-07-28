/**
 * Sync Stripe transfer / Connect payout webhook events into local payout rows.
 * Idempotent: only advances status; never invents money movement.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type TransferPayoutSyncResult = {
  ok: boolean;
  matched: boolean;
  tables: string[];
  status?: string;
  error?: string;
};

function asId(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

/** Maps Stripe payout webhook events to local payout status values. */
export function resolveStripePayoutNextStatus(
  eventType: string,
  stripeStatusRaw: unknown
): "processing" | "paid" | "failed" | "canceled" {
  const stripeStatus = String(stripeStatusRaw ?? "").toLowerCase();

  if (eventType === "payout.created") {
    if (stripeStatus === "paid") return "paid";
    if (stripeStatus === "failed") return "failed";
    if (stripeStatus === "canceled") return "canceled";
    return "processing";
  }
  if (eventType === "payout.paid" || stripeStatus === "paid") return "paid";
  if (eventType === "payout.canceled" || stripeStatus === "canceled") {
    return "canceled";
  }
  if (eventType === "payout.failed" || stripeStatus === "failed") {
    return "failed";
  }
  if (eventType === "payout.updated") {
    if (stripeStatus === "paid") return "paid";
    if (stripeStatus === "failed") return "failed";
    if (stripeStatus === "canceled") return "canceled";
    return "processing";
  }
  return "processing";
}

export async function syncStripeTransferEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
): Promise<TransferPayoutSyncResult> {
  const transfer = event.data.object as Stripe.Transfer;
  const transferId = asId(transfer.id);
  if (!transferId) {
    return { ok: false, matched: false, tables: [], error: "missing_transfer_id" };
  }

  const tables: string[] = [];
  const reversed = event.type === "transfer.reversed";
  const failedLike =
    reversed ||
    String((transfer as { reversed?: boolean }).reversed ?? false) === "true";
  const nextStatus = failedLike ? "failed" : "succeeded";

  const { data: orderRows, error: orderErr } = await supabaseAdmin
    .from("order_payouts")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_transfer_id", transferId)
    .select("id");

  if (orderErr) {
    return { ok: false, matched: false, tables, error: orderErr.message };
  }
  if (Array.isArray(orderRows) && orderRows.length > 0) {
    tables.push("order_payouts");
  }

  for (const table of [
    "marketplace_seller_payouts",
    "marketplace_driver_payouts",
  ] as const) {
    const status = failedLike ? "failed" : "paid";
    const { data, error } = await supabaseAdmin
      .from(table)
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_transfer_id", transferId)
      .select("id");
    if (error) {
      console.error(`[stripe-transfer-webhook] ${table} update failed`, error.message);
      continue;
    }
    if (Array.isArray(data) && data.length > 0) tables.push(table);
  }

  console.log("[stripe-transfer-webhook] synced", {
    event_type: event.type,
    transferId,
    nextStatus,
    tables,
  });

  return {
    ok: true,
    matched: tables.length > 0,
    tables,
    status: nextStatus,
  };
}

export async function syncStripePayoutEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
): Promise<TransferPayoutSyncResult> {
  const payout = event.data.object as Stripe.Payout;
  const payoutId = asId(payout.id);
  if (!payoutId) {
    return { ok: false, matched: false, tables: [], error: "missing_payout_id" };
  }

  const tables: string[] = [];
  const nextStatus = resolveStripePayoutNextStatus(event.type, payout.status);

  // Driver wallet cashouts store Stripe payout id via finalize_driver_payout.
  const { data: driverPayouts, error: driverErr } = await supabaseAdmin
    .from("driver_payouts")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_payout_id", payoutId)
    .select("id");

  if (driverErr) {
    // Table may use different column naming in some envs — fail soft.
    console.error("[stripe-payout-webhook] driver_payouts update failed", driverErr.message);
  } else if (Array.isArray(driverPayouts) && driverPayouts.length > 0) {
    tables.push("driver_payouts");
  }

  // Also try payout_transactions ledger used by wallet UI.
  const { data: txRows, error: txErr } = await supabaseAdmin
    .from("payout_transactions")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
      ...(nextStatus === "paid" ? { paid_at: new Date().toISOString() } : {}),
      ...(nextStatus === "canceled" ? { canceled_at: new Date().toISOString() } : {}),
      ...(nextStatus === "failed" || nextStatus === "canceled"
        ? { failure_reason: String(payout.failure_message ?? event.type) }
        : {}),
    })
    .eq("external_reference", payoutId)
    .select("id");

  if (txErr) {
    console.error(
      "[stripe-payout-webhook] payout_transactions update failed",
      txErr.message,
    );
  } else if (Array.isArray(txRows) && txRows.length > 0) {
    tables.push("payout_transactions");
  }

  console.log("[stripe-payout-webhook] synced", {
    event_type: event.type,
    payoutId,
    nextStatus,
    tables,
  });

  return {
    ok: true,
    matched: tables.length > 0,
    tables,
    status: nextStatus,
  };
}
