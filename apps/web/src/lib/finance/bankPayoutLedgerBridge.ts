/**
 * Fail-closed audit rows for Connect → bank (po_*) payouts.
 * Stripe idempotency prevents duplicate po_*; local DB must reconcile on retry.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import type { PayoutTransactionRow } from "@/lib/payoutTypes";

export type SundayBankPayoutAuditInput = {
  countryCode: string;
  recipientType: "driver" | "restaurant" | "seller";
  recipientUserId: string;
  amountCents: number;
  currency: string;
  stripePayoutId: string;
  destinationAccount: string;
  ledgerSource: string;
  etDateKey: string;
  moneyModel: string;
};

async function findBankPayoutAuditByPoId(
  supabaseAdmin: SupabaseClient,
  stripePayoutId: string,
): Promise<PayoutTransactionRow | null> {
  const poId = String(stripePayoutId ?? "").trim();
  if (!poId.startsWith("po_")) return null;
  const { data, error } = await supabaseAdmin
    .from("payout_transactions")
    .select("*")
    .eq("external_reference", poId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PayoutTransactionRow | null) ?? null;
}

export async function ensureSundayBankPayoutAuditRecord(
  supabaseAdmin: SupabaseClient,
  input: SundayBankPayoutAuditInput,
): Promise<
  | { ok: true; payoutTransactionId: string; created: boolean }
  | {
      ok: false;
      reconcile_required: true;
      error: string;
      stripe_payout_id: string;
    }
> {
  const poId = String(input.stripePayoutId ?? "").trim();
  if (!poId.startsWith("po_")) {
    return {
      ok: false,
      reconcile_required: true,
      error: "invalid_stripe_payout_id",
      stripe_payout_id: poId,
    };
  }

  const existing = await findBankPayoutAuditByPoId(supabaseAdmin, poId);
  if (existing) {
    return {
      ok: true,
      payoutTransactionId: existing.id,
      created: false,
    };
  }

  try {
    const audit = await createPayoutTransaction(supabaseAdmin, {
      countryCode: input.countryCode,
      recipientType: input.recipientType,
      recipientUserId: input.recipientUserId,
      provider: "stripe_connect",
      methodCode: "payout_stripe_connect_sunday",
      amountCents: input.amountCents,
      currency: input.currency,
      status: "processing",
      payoutMode: "automatic",
      destinationAccount: input.destinationAccount,
      externalReference: poId,
      providerPayload: {
        source: input.ledgerSource,
        stripe_payout_id: poId,
        et_date: input.etDateKey,
        timezone: "America/New_York",
        no_minimum: true,
        money_out_model: input.moneyModel,
      },
    });
    await updatePayoutTransactionStatus(supabaseAdmin, audit.id, "processing", {
      external_reference: poId,
      provider_payload: {
        source: input.ledgerSource,
        stripe_payout_id: poId,
        money_out_model: input.moneyModel,
        worker_finance: true,
      },
    });
    return { ok: true, payoutTransactionId: audit.id, created: true };
  } catch (err) {
    const replay = await findBankPayoutAuditByPoId(supabaseAdmin, poId);
    if (replay) {
      return {
        ok: true,
        payoutTransactionId: replay.id,
        created: false,
      };
    }
    return {
      ok: false,
      reconcile_required: true,
      error: err instanceof Error ? err.message : String(err),
      stripe_payout_id: poId,
    };
  }
}
