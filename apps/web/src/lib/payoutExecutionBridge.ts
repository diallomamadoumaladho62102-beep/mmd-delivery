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

  const payout = await createPayoutTransaction(supabaseAdmin, {
    countryCode: input.countryCode,
    recipientType,
    recipientUserId: input.recipientUserId,
    provider: method?.provider ?? "stripe_connect",
    methodCode: method?.method_code ?? "payout_stripe_connect",
    amountCents: input.amountCents,
    currency: input.currency,
    status: "paid",
    payoutMode: method?.auto_payout_enabled ? "automatic" : "manual",
    entityType: "order",
    entityId: input.orderId,
    orderPayoutId: input.orderPayoutId,
    externalReference: input.stripeTransferId,
    destinationAccount: input.destinationAccountId,
    providerPayload: { source: "stripe_connect_transfer" },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: recipientType,
    accountUserId: input.recipientUserId,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "credit",
    amountCents: input.amountCents,
    referenceType: "payout_transaction",
    referenceId: payout.id,
    description: `Payout for order ${input.orderId}`,
    metadata: { order_payout_id: input.orderPayoutId, target: input.target },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "debit",
    amountCents: input.amountCents,
    referenceType: "payout_transaction",
    referenceId: payout.id,
    description: `Platform disbursement for order ${input.orderId}`,
    metadata: { order_payout_id: input.orderPayoutId },
  });

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
): "driver" | "restaurant" | "seller" | "partner" {
  return recipientType;
}
