import type { SupabaseClient } from "@supabase/supabase-js";
import { recordInboundPaymentWalletEntries } from "@/lib/inboundWalletBridge";
import {
  getPaymentTransactionByExternalReference,
} from "@/lib/paymentTransactionService";
import type { PaymentEntityType, PaymentTransactionRow } from "@/lib/paymentTypes";

export type StripeInboundWalletInput = {
  paymentIntentId: string;
  entityType: PaymentEntityType;
  entityId: string;
  userId: string;
  orderId?: string | null;
  countryCode: string;
  amountCents: number;
  currency: string;
  source: string;
};

function normalizeCountryCode(value: string): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return "US";
}

function normalizeCurrency(value: string): string {
  return String(value ?? "usd").trim().toLowerCase();
}

export async function recordStripeInboundWalletBridge(
  supabaseAdmin: SupabaseClient,
  input: StripeInboundWalletInput
): Promise<{ ok: true; transactionId: string; created: boolean } | { ok: false; error: string }> {
  const paymentIntentId = String(input.paymentIntentId ?? "").trim();
  if (!paymentIntentId) {
    return { ok: false, error: "missing_payment_intent_id" };
  }

  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "invalid_amount_cents" };
  }

  const existing = await getPaymentTransactionByExternalReference(
    supabaseAdmin,
    "stripe",
    paymentIntentId
  );

  if (existing && existing.status === "paid") {
    const ledgerReplay = await recordInboundPaymentWalletEntriesSafe(
      supabaseAdmin,
      existing,
      paymentIntentId,
    );
    if (ledgerReplay.ok === false) {
      return { ok: false, error: ledgerReplay.error };
    }
    return { ok: true, transactionId: existing.id, created: false };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .insert({
      order_id: input.orderId ?? null,
      user_id: input.userId,
      entity_type: input.entityType,
      entity_id: input.entityId,
      country_code: normalizeCountryCode(input.countryCode),
      provider: "stripe",
      method_code: "card",
      amount_cents: Math.round(input.amountCents),
      currency: normalizeCurrency(input.currency),
      status: "paid",
      external_reference: paymentIntentId,
      paid_at: nowIso,
      provider_payload: {
        source: input.source,
        payment_intent_id: paymentIntentId,
      },
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      const replay = await getPaymentTransactionByExternalReference(
        supabaseAdmin,
        "stripe",
        paymentIntentId
      );
      if (replay?.status === "paid") {
        // Race: another writer inserted first — still ensure ledger rows exist.
        const ledgerReplay = await recordInboundPaymentWalletEntriesSafe(
          supabaseAdmin,
          replay,
          paymentIntentId,
        );
        if (ledgerReplay.ok === false) {
          return { ok: false, error: ledgerReplay.error };
        }
        return { ok: true, transactionId: replay.id, created: false };
      }
    }
    return { ok: false, error: error?.message ?? "payment_transaction_insert_failed" };
  }

  const transaction = data as PaymentTransactionRow;

  const ledgerWrite = await recordInboundPaymentWalletEntriesSafe(
    supabaseAdmin,
    transaction,
    paymentIntentId,
  );
  if (ledgerWrite.ok === false) {
    return { ok: false, error: ledgerWrite.error };
  }

  return { ok: true, transactionId: transaction.id, created: true };
}

async function recordInboundPaymentWalletEntriesSafe(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow,
  paymentIntentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await recordInboundPaymentWalletEntries(supabaseAdmin, transaction);
    return { ok: true };
  } catch (walletErr) {
    console.error("[stripeInboundWalletBridge] ledger write failed", {
      payment_intent_id: paymentIntentId,
      transaction_id: transaction.id,
      error: walletErr,
    });
    return { ok: false, error: "wallet_ledger_write_failed" };
  }
}

function resolveAmountCentsFromTotals(input: {
  total_cents?: unknown;
  total?: unknown;
  grand_total?: unknown;
}): number | null {
  const cents = Number(input.total_cents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents);

  const total = Number(input.total ?? input.grand_total);
  if (Number.isFinite(total) && total > 0) return Math.round(total * 100);

  return null;
}

export async function bridgeStripeWalletFromPaidOrder(
  supabaseAdmin: SupabaseClient,
  input: {
    paymentIntentId: string;
    order: {
      id: string;
      client_user_id?: string | null;
      created_by?: string | null;
      user_id?: string | null;
      client_id?: string | null;
      total_cents?: number | null;
      total?: number | null;
      grand_total?: number | null;
      currency?: string | null;
      country_code?: string | null;
    };
    source: string;
    countryCode?: string | null;
  }
) {
  const userId = String(
    input.order.client_user_id ??
      input.order.created_by ??
      input.order.user_id ??
      input.order.client_id ??
      ""
  ).trim();

  const amountCents = resolveAmountCentsFromTotals(input.order);
  if (!userId || !amountCents) {
    return { ok: false as const, error: "missing_wallet_bridge_fields" };
  }

  return recordStripeInboundWalletBridge(supabaseAdmin, {
    paymentIntentId: input.paymentIntentId,
    entityType: "order",
    entityId: input.order.id,
    userId,
    orderId: input.order.id,
    countryCode: input.countryCode ?? String(input.order.country_code ?? "US"),
    amountCents,
    currency: input.order.currency ?? "usd",
    source: input.source,
  });
}

export async function bridgeStripeWalletFromPaidDeliveryRequest(
  supabaseAdmin: SupabaseClient,
  input: {
    paymentIntentId: string;
    deliveryRequest: {
      id: string;
      client_user_id?: string | null;
      created_by?: string | null;
      total_cents?: number | null;
      total?: number | null;
      currency?: string | null;
      country_code?: string | null;
    };
    source: string;
    countryCode?: string | null;
  }
) {
  const userId = String(
    input.deliveryRequest.client_user_id ?? input.deliveryRequest.created_by ?? ""
  ).trim();

  const amountCents = resolveAmountCentsFromTotals(input.deliveryRequest);
  if (!userId || !amountCents) {
    return { ok: false as const, error: "missing_wallet_bridge_fields" };
  }

  return recordStripeInboundWalletBridge(supabaseAdmin, {
    paymentIntentId: input.paymentIntentId,
    entityType: "delivery_request",
    entityId: input.deliveryRequest.id,
    userId,
    orderId: null,
    countryCode:
      input.countryCode ?? String(input.deliveryRequest.country_code ?? "US"),
    amountCents,
    currency: input.deliveryRequest.currency ?? "usd",
    source: input.source,
  });
}

export async function bridgeStripeWalletFromPaidTaxiRide(
  supabaseAdmin: SupabaseClient,
  input: {
    paymentIntentId: string;
    taxiRide: {
      id: string;
      client_user_id?: string | null;
      created_by?: string | null;
      total_cents?: number | null;
      total?: number | null;
      fare_total?: number | null;
      currency?: string | null;
      country_code?: string | null;
    };
    source: string;
    countryCode?: string | null;
  }
) {
  const userId = String(
    input.taxiRide.client_user_id ?? input.taxiRide.created_by ?? ""
  ).trim();

  const amountCents =
    resolveAmountCentsFromTotals(input.taxiRide) ??
    (Number.isFinite(Number(input.taxiRide.fare_total))
      ? Math.round(Number(input.taxiRide.fare_total) * 100)
      : null);

  if (!userId || !amountCents) {
    return { ok: false as const, error: "missing_wallet_bridge_fields" };
  }

  return recordStripeInboundWalletBridge(supabaseAdmin, {
    paymentIntentId: input.paymentIntentId,
    entityType: "taxi_ride",
    entityId: input.taxiRide.id,
    userId,
    orderId: null,
    countryCode: input.countryCode ?? String(input.taxiRide.country_code ?? "US"),
    amountCents,
    currency: input.taxiRide.currency ?? "usd",
    source: input.source,
  });
}
