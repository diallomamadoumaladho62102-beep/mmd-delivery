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
