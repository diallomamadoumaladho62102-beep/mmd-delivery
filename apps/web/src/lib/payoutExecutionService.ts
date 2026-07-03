import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchPayoutToProvider } from "@/lib/payoutProviders";
import {
  createPayoutTransaction,
  updatePayoutTransactionStatus,
} from "@/lib/payoutTransactionService";
import type { PayoutMethodRow, PayoutProvider, PayoutRecipientType } from "@/lib/payoutTypes";

export type QueueOutboundPayoutInput = {
  countryCode: string;
  recipientType: PayoutRecipientType;
  recipientUserId: string;
  method: Pick<
    PayoutMethodRow,
    "provider" | "method_code" | "auto_payout_enabled" | "test_mode"
  >;
  amountCents: number;
  currency: string;
  entityType?: string | null;
  entityId?: string | null;
  orderPayoutId?: string | null;
  destinationAccount?: string | null;
  approvedBy?: string | null;
};

export async function queueOutboundPayout(
  supabaseAdmin: SupabaseClient,
  input: QueueOutboundPayoutInput
) {
  const payout = await createPayoutTransaction(supabaseAdmin, {
    countryCode: input.countryCode,
    recipientType: input.recipientType,
    recipientUserId: input.recipientUserId,
    provider: input.method.provider,
    methodCode: input.method.method_code,
    amountCents: input.amountCents,
    currency: input.currency,
    status: "pending",
    payoutMode: input.method.auto_payout_enabled ? "automatic" : "manual",
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    orderPayoutId: input.orderPayoutId ?? null,
    destinationAccount: input.destinationAccount ?? null,
  });

  if (input.approvedBy) {
    await updatePayoutTransactionStatus(supabaseAdmin, payout.id, "approved", {
      approved_by: input.approvedBy,
    });
  }

  const dispatch = await dispatchPayoutToProvider({
    payoutTransactionId: payout.id,
    provider: input.method.provider as PayoutProvider,
    countryCode: input.countryCode,
    amountCents: input.amountCents,
    currency: input.currency,
    destinationAccount: input.destinationAccount ?? null,
    autoPayoutEnabled: input.method.auto_payout_enabled,
    testMode: input.method.test_mode,
  });

  if (dispatch.ok === false) {
    await updatePayoutTransactionStatus(supabaseAdmin, payout.id, "failed", {
      failure_reason: dispatch.error,
    });
    return { ok: false as const, error: dispatch.error, payout };
  }

  if (dispatch.mode === "manual") {
    return {
      ok: true as const,
      mode: "manual" as const,
      message: dispatch.message,
      payout,
    };
  }

  await updatePayoutTransactionStatus(supabaseAdmin, payout.id, "processing", {
    external_reference: dispatch.external_reference ?? null,
  });

  return {
    ok: true as const,
    mode: "automatic" as const,
    payout,
  };
}
