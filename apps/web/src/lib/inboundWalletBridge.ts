import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendWalletLedgerEntry,
  buildWalletLedgerIdempotencyKey,
} from "@/lib/payoutTransactionService";
import { entityTypeToChargeCategory } from "@/lib/payoutTypes";
import type { PaymentTransactionRow } from "@/lib/paymentTypes";

export type InboundWalletLedgerResult = {
  ok: true;
  created: boolean;
  creditId: string;
  debitId: string;
  source: "rpc" | "fallback";
};

export type ReverseInboundWalletLedgerResult = {
  ok: true;
  created: boolean;
  debitId: string;
  creditId: string;
  source: "rpc" | "fallback";
};

/**
 * Records the inbound payment wallet pair (platform credit + client debit).
 * Prefer atomic RPC; fall back to idempotent appends if RPC is unavailable.
 * Replays never create a second financial impact.
 */
export async function recordInboundPaymentWalletEntries(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<InboundWalletLedgerResult> {
  const creditDescription = `Inbound ${entityTypeToChargeCategory(transaction.entity_type)} payment`;
  const debitDescription = "Client payment captured by MMD";

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "record_inbound_payment_wallet_entries",
    {
      p_transaction_id: transaction.id,
      p_user_id: transaction.user_id,
      p_country_code: transaction.country_code,
      p_currency: transaction.currency,
      p_amount_cents: transaction.amount_cents,
      p_entity_type: transaction.entity_type,
      p_entity_id: transaction.entity_id,
      p_provider: transaction.provider,
      p_credit_description: creditDescription,
      p_debit_description: debitDescription,
    },
  );

  if (!rpcError && rpcData && typeof rpcData === "object") {
    const payload = rpcData as Record<string, unknown>;
    if (payload.ok === true && payload.credit_id && payload.debit_id) {
      return {
        ok: true,
        created: Boolean(payload.created),
        creditId: String(payload.credit_id),
        debitId: String(payload.debit_id),
        source: "rpc",
      };
    }
    if (payload.ok === false) {
      throw new Error(String(payload.error ?? "wallet_ledger_rpc_failed"));
    }
  }

  // RPC missing / unavailable — idempotent sequential fallback (non-production only).
  if (rpcError && !isMissingRpcError(rpcError, "record_inbound_payment_wallet_entries")) {
    throw new Error(rpcError.message);
  }

  const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
  const isProductionRuntime =
    appEnv === "production" || process.env.NODE_ENV === "production";
  if (isProductionRuntime) {
    throw new Error(
      "record_inbound_payment_wallet_entries RPC required in production (sequential wallet fallback disabled)"
    );
  }

  const credit = await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "credit",
    amountCents: transaction.amount_cents,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    description: creditDescription,
    metadata: {
      entity_type: transaction.entity_type,
      entity_id: transaction.entity_id,
      provider: transaction.provider,
    },
  });

  const debit = await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "client",
    accountUserId: transaction.user_id,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "debit",
    amountCents: transaction.amount_cents,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    description: debitDescription,
    metadata: {
      entity_type: transaction.entity_type,
      entity_id: transaction.entity_id,
    },
  });

  const creditKey = buildWalletLedgerIdempotencyKey({
    accountType: "platform",
    accountUserId: null,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    direction: "credit",
  });
  const debitKey = buildWalletLedgerIdempotencyKey({
    accountType: "client",
    accountUserId: transaction.user_id,
    referenceType: "payment_transaction",
    referenceId: transaction.id,
    direction: "debit",
  });

  return {
    ok: true,
    created: true,
    creditId: String((credit as { id?: string }).id ?? creditKey),
    debitId: String((debit as { id?: string }).id ?? debitKey),
    source: "fallback",
  };
}

/**
 * Compensating reverse for a prior inbound payment (platform debit + client credit).
 * Idempotent on Stripe refund id. Prefer atomic RPC.
 */
export async function reverseInboundPaymentWalletEntries(
  supabaseAdmin: SupabaseClient,
  input: {
    transaction: PaymentTransactionRow;
    refundId: string;
    amountCents: number;
  }
): Promise<ReverseInboundWalletLedgerResult> {
  const refundId = String(input.refundId ?? "").trim();
  if (!refundId) {
    throw new Error("missing_refund_id");
  }
  const amountCents = Math.max(0, Math.round(Number(input.amountCents ?? 0)));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("invalid_amount_cents");
  }

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
    "reverse_inbound_payment_wallet_entries",
    {
      p_transaction_id: input.transaction.id,
      p_refund_id: refundId,
      p_amount_cents: amountCents,
    },
  );

  if (!rpcError && rpcData && typeof rpcData === "object") {
    const payload = rpcData as Record<string, unknown>;
    if (payload.ok === true && payload.debit_id && payload.credit_id) {
      return {
        ok: true,
        created: Boolean(payload.created),
        debitId: String(payload.debit_id),
        creditId: String(payload.credit_id),
        source: "rpc",
      };
    }
    if (payload.ok === false) {
      throw new Error(String(payload.error ?? "wallet_ledger_reverse_rpc_failed"));
    }
  }

  if (rpcError && !isMissingRpcError(rpcError, "reverse_inbound_payment_wallet_entries")) {
    throw new Error(rpcError.message);
  }

  const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
  const isProductionRuntime =
    appEnv === "production" || process.env.NODE_ENV === "production";
  if (isProductionRuntime) {
    throw new Error(
      "reverse_inbound_payment_wallet_entries RPC required in production (sequential wallet fallback disabled)"
    );
  }

  const { transaction } = input;

  const debit = await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "platform",
    accountUserId: null,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "debit",
    amountCents,
    referenceType: "refund",
    referenceId: refundId,
    description: "Inbound payment refund (platform reverse)",
    metadata: {
      payment_transaction_id: transaction.id,
      refund_id: refundId,
      source: "reverse_inbound_payment_wallet_entries",
    },
  });

  const credit = await appendWalletLedgerEntry(supabaseAdmin, {
    accountType: "client",
    accountUserId: transaction.user_id,
    countryCode: transaction.country_code,
    currency: transaction.currency,
    direction: "credit",
    amountCents,
    referenceType: "refund",
    referenceId: refundId,
    description: "Client payment refund credit",
    metadata: {
      payment_transaction_id: transaction.id,
      refund_id: refundId,
      source: "reverse_inbound_payment_wallet_entries",
    },
  });

  return {
    ok: true,
    created: true,
    debitId: String((debit as { id?: string }).id ?? ""),
    creditId: String((credit as { id?: string }).id ?? ""),
    source: "fallback",
  };
}

function isMissingRpcError(
  error: { message?: string; code?: string },
  fnName: string
): boolean {
  const message = String(error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    message.includes(`function public.${fnName}`) ||
    message.includes("schema cache") ||
    error.code === "PGRST202"
  );
}
