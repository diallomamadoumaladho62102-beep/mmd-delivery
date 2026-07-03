import type { SupabaseClient } from "@supabase/supabase-js";
import { appendWalletLedgerEntry } from "@/lib/payoutTransactionService";
import type { WaitTimerEntityType } from "@/lib/waitTimerTypes";

export async function recordWaitLateFeeLedgerEntries(
  supabaseAdmin: SupabaseClient,
  input: {
    entityType: WaitTimerEntityType;
    entityId: string;
    clientUserId: string;
    driverUserId: string;
    countryCode: string;
    currency: string;
    feeCents: number;
    referenceId: string;
  }
) {
  if (input.feeCents <= 0) return;

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "credit",
    amountCents: input.feeCents,
    referenceType: "payment_transaction",
    referenceId: input.referenceId,
    description: `Wait late fee (${input.entityType})`,
    metadata: {
      entity_type: input.entityType,
      entity_id: input.entityId,
      charge_category: "late_fee",
    },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "client",
    accountUserId: input.clientUserId,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "debit",
    amountCents: input.feeCents,
    referenceType: "payment_transaction",
    referenceId: input.referenceId,
    description: "Wait late fee charged to client",
    metadata: {
      entity_type: input.entityType,
      entity_id: input.entityId,
      charge_category: "late_fee",
    },
  });

  await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "driver",
    accountUserId: input.driverUserId,
    countryCode: input.countryCode,
    currency: input.currency,
    direction: "credit",
    amountCents: input.feeCents,
    referenceType: "payment_transaction",
    referenceId: input.referenceId,
    description: "Wait late fee pass-through to driver",
    metadata: {
      entity_type: input.entityType,
      entity_id: input.entityId,
    },
  });
}
