/**
 * Reconcile local bank payout rows (po_*) against live Stripe Connect payouts.
 * Idempotent: only advances status toward Stripe truth; never invents money.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveStripePayoutNextStatus } from "@/lib/stripeTransferPayoutWebhook";
import { stripe } from "@/lib/stripe";

export type BankPayoutReconcileResult = {
  ok: boolean;
  scanned: number;
  updated: number;
  mismatches: Array<{
    payout_transaction_id: string;
    stripe_payout_id: string;
    local_status: string;
    stripe_status: string;
  }>;
  error?: string;
};

/**
 * Pull recent processing/pending bank payouts and sync status from Stripe.
 */
export async function reconcileBankPayouts(params: {
  supabaseAdmin: SupabaseClient;
  /** Connect account id (acct_…) — required for Stripe Connect retrieve. */
  stripeAccountId: string;
  limit?: number;
}): Promise<BankPayoutReconcileResult> {
  const limit = Math.min(Math.max(Number(params.limit ?? 25), 1), 100);
  // Include local "paid" so premature create⇒paid rows can be corrected
  // when Stripe is still pending/in_transit (e.g. po_* Sunday bank payouts).
  const { data, error } = await params.supabaseAdmin
    .from("payout_transactions")
    .select("id, status, external_reference, destination_account")
    .eq("destination_account", params.stripeAccountId)
    .in("status", ["pending", "processing", "approved", "paid"])
    .like("external_reference", "po_%")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return {
      ok: false,
      scanned: 0,
      updated: 0,
      mismatches: [],
      error: error.message,
    };
  }

  const rows = data ?? [];
  let updated = 0;
  const mismatches: BankPayoutReconcileResult["mismatches"] = [];

  for (const row of rows) {
    const poId = String(row.external_reference ?? "").trim();
    if (!poId.startsWith("po_")) continue;
    try {
      const payout = await stripe.payouts.retrieve(poId, {
        stripeAccount: params.stripeAccountId,
      });
      const next = resolveStripePayoutNextStatus(
        `payout.${String(payout.status)}`,
        payout.status,
      );
      const local = String(row.status ?? "").toLowerCase();
      if (local !== next) {
        mismatches.push({
          payout_transaction_id: String(row.id),
          stripe_payout_id: poId,
          local_status: local,
          stripe_status: String(payout.status),
        });
        const { error: upErr } = await params.supabaseAdmin
          .from("payout_transactions")
          .update({
            status: next,
            paid_at: next === "paid" ? new Date().toISOString() : null,
            provider_payload: {
              reconcile: true,
              stripe_payout_id: poId,
              stripe_status: payout.status,
              stripe_method: payout.method,
              stripe_destination: payout.destination,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("external_reference", poId);
        if (!upErr) updated += 1;
      }
    } catch {
      // continue — one bad retrieve must not abort the batch
    }
  }

  return { ok: true, scanned: rows.length, updated, mismatches };
}
