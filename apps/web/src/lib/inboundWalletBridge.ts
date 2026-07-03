import type { SupabaseClient } from "@supabase/supabase-js";
import { appendWalletLedgerEntry } from "@/lib/payoutTransactionService";
import { entityTypeToChargeCategory } from "@/lib/payoutTypes";
import type { PaymentTransactionRow } from "@/lib/paymentTypes";

export async function recordInboundPaymentWalletEntries(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
) {
  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "credit",
    amountCents: transaction.amount_cents,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    description: `Inbound ${entityTypeToChargeCategory(transaction.entity_type)} payment`,
    metadata: {
      entity_type: transaction.entity_type,
      entity_id: transaction.entity_id,
      provider: transaction.provider,
    },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "client",
    accountUserId: transaction.user_id,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "debit",
    amountCents: transaction.amount_cents,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    description: "Client payment captured by MMD",
    metadata: {
      entity_type: transaction.entity_type,
      entity_id: transaction.entity_id,
    },
  });
}
