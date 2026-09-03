import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDefaultPayoutMethod } from "@/lib/payoutMethodRouting";
import {
  appendWalletLedgerEntry,
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import {
  mapOrderPayoutTargetToRecipientType,
  type PayoutRecipientType,
  type PayoutTransactionRow,
} from "@/lib/payoutTypes";

type OrderPayoutBridgeInput = {
  orderPayoutId: string;
  orderId: string;
  target: string;
  recipientUserId: string;
  countryCode: string;
  currency: string;
  amountCents: number;
  stripeTransferId: string;
  destinationAccountId: string;
};

async function findExistingPayoutTransaction(
  supabaseAdmin: SupabaseClient,
  input: OrderPayoutBridgeInput
): Promise<PayoutTransactionRow | null> {
  if (input.orderPayoutId) {
    const { data, error } = await supabaseAdmin
      .from("payout_transactions")
      .select("*")
      .eq("order_payout_id", input.orderPayoutId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PayoutTransactionRow;
  }

  if (input.stripeTransferId) {
    const { data, error } = await supabaseAdmin
      .from("payout_transactions")
      .select("*")
      .eq("external_reference", input.stripeTransferId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PayoutTransactionRow;
  }

  return null;
}

async function ensureOutboundLedgerPair(
  supabaseAdmin: SupabaseClient,
  input: OrderPayoutBridgeInput,
  payout: PayoutTransactionRow,
  recipientType: PayoutRecipientType
) {
  // Stable ledger keys on order_payout_id so retries never double-credit.
  const ledgerReferenceId = input.orderPayoutId;

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: recipientType,
    accountUserId: input.recipientUserId,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "credit",
    amountCents: input.amountCents,
    referenceType: "payout_transaction",
    referenceId: ledgerReferenceId,
    description: `Payout for order ${input.orderId}`,
    metadata: {
      order_payout_id: input.orderPayoutId,
      payout_transaction_id: payout.id,
      target: input.target,
      stripe_transfer_id: input.stripeTransferId,
    },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "debit",
    amountCents: input.amountCents,
    referenceType: "payout_transaction",
    referenceId: ledgerReferenceId,
    description: `Platform disbursement for order ${input.orderId}`,
    metadata: {
      order_payout_id: input.orderPayoutId,
      payout_transaction_id: payout.id,
      stripe_transfer_id: input.stripeTransferId,
    },
  });
}

export async function isOrderTransferLedgerComplete(
  supabaseAdmin: SupabaseClient,
  input: Pick<OrderPayoutBridgeInput, "orderPayoutId" | "stripeTransferId">,
): Promise<{
  complete: boolean;
  payoutTransactionId?: string;
  missing: string[];
}> {
  const payout = await findExistingPayoutTransaction(
    supabaseAdmin,
    input as OrderPayoutBridgeInput,
  );
  if (!payout) {
    return { complete: false, missing: ["payout_transaction"] };
  }

  const { data: rows, error } = await supabaseAdmin
    .from("wallet_ledger")
    .select("direction")
    .eq("reference_type", "payout_transaction")
    .eq("reference_id", input.orderPayoutId);

  if (error) {
    throw new Error(error.message);
  }

  const directions = new Set(
    (rows ?? []).map((row) => String(row.direction ?? "").toLowerCase()),
  );
  const missing: string[] = [];
  if (!directions.has("credit")) missing.push("ledger_credit");
  if (!directions.has("debit")) missing.push("ledger_debit");

  return {
    complete: missing.length === 0,
    payoutTransactionId: payout.id,
    missing,
  };
}

/**
 * Idempotent repair when Stripe Transfer succeeded but local ledger is incomplete.
 * Safe to call on cron retry / already_succeeded short-circuit.
 */
export async function reconcileSuccessfulStripeOrderPayoutIfNeeded(
  supabaseAdmin: SupabaseClient,
  input: OrderPayoutBridgeInput,
): Promise<
  | { ok: true; reconciled: boolean; alreadyComplete: boolean }
  | {
      ok: false;
      reconcile_required: true;
      error: string;
      missing: string[];
      transfer_id: string;
      order_payout_id: string;
    }
> {
  const before = await isOrderTransferLedgerComplete(supabaseAdmin, input);
  if (before.complete) {
    return { ok: true, reconciled: false, alreadyComplete: true };
  }

  try {
    await recordSuccessfulStripeOrderPayout(supabaseAdmin, input);
  } catch (err) {
    const afterErr = await isOrderTransferLedgerComplete(supabaseAdmin, input);
    if (afterErr.complete) {
      return { ok: true, reconciled: true, alreadyComplete: false };
    }
    return {
      ok: false,
      reconcile_required: true,
      error: err instanceof Error ? err.message : String(err),
      missing: afterErr.missing.length ? afterErr.missing : before.missing,
      transfer_id: input.stripeTransferId,
      order_payout_id: input.orderPayoutId,
    };
  }

  const after = await isOrderTransferLedgerComplete(supabaseAdmin, input);
  if (!after.complete) {
    return {
      ok: false,
      reconcile_required: true,
      error: "ledger_still_incomplete_after_reconcile",
      missing: after.missing,
      transfer_id: input.stripeTransferId,
      order_payout_id: input.orderPayoutId,
    };
  }

  return { ok: true, reconciled: true, alreadyComplete: false };
}

export async function recordSuccessfulStripeOrderPayout(
  supabaseAdmin: SupabaseClient,
  input: OrderPayoutBridgeInput
) {
  const recipientType = mapOrderPayoutTargetToRecipientType(input.target);
  const method = await resolveDefaultPayoutMethod(
    supabaseAdmin,
    input.countryCode,
    recipientType
  );

  let payout = await findExistingPayoutTransaction(supabaseAdmin, input);

  if (!payout) {
    try {
      payout = await createPayoutTransaction(supabaseAdmin, {
        countryCode: input.countryCode,
        recipientType,
        recipientUserId: input.recipientUserId,
        provider: method?.provider ?? "stripe_connect",
        methodCode: "connect_internal_transfer",
        amountCents: input.amountCents,
        currency: input.currency,
        // SCT credit only — NOT a worker bank/card Cash Out (po_*).
        // Status "paid" here means transfer settled to Connect, not bank arrival.
        status: "paid",
        payoutMode: method?.auto_payout_enabled ? "automatic" : "manual",
        entityType: "order",
        entityId: input.orderId,
        orderPayoutId: input.orderPayoutId,
        externalReference: input.stripeTransferId,
        destinationAccount: input.destinationAccountId,
        providerPayload: {
          source: "stripe_connect_transfer",
          money_rail: "sct_internal",
          not_worker_bank_payout: true,
        },
      });
    } catch (err) {
      // Concurrent insert — re-read by business keys.
      payout = await findExistingPayoutTransaction(supabaseAdmin, input);
      if (!payout) throw err;
    }
  }

  await ensureOutboundLedgerPair(
    supabaseAdmin,
    input,
    payout,
    recipientType
  );

  return payout;
}

export async function markPayoutProcessingFromManualApproval(
  supabaseAdmin: SupabaseClient,
  payoutId: string,
  approvedBy: string
) {
  return updatePayoutTransactionStatus(supabaseAdmin, payoutId, "processing", {
    approved_by: approvedBy,
  });
}

export function recipientTypeToWalletAccount(
  recipientType: PayoutRecipientType
): "driver" | "restaurant" | "seller" | "partner" | "business" {
  return recipientType;
}
