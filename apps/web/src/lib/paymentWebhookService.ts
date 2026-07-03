import type { SupabaseClient } from "@supabase/supabase-js";
import { applyTransactionStatusUpdate } from "@/lib/paymentEntityCompletion";
import { getPaymentProviderAdapter, parsePaymentProvider } from "@/lib/paymentProviders";
import {
  getPaymentTransactionByExternalReference,
  getPaymentTransactionById,
  recordPaymentWebhookEvent,
} from "@/lib/paymentTransactionService";

export async function handleProviderWebhook(
  supabaseAdmin: SupabaseClient,
  providerRaw: string,
  body: unknown,
  headers: Headers
) {
  const provider = parsePaymentProvider(providerRaw);
  if (!provider) {
    return { ok: false as const, status: 400, error: "unknown_provider" };
  }

  const adapter = getPaymentProviderAdapter(provider);
  const parsed = await adapter.parseWebhook(body, headers);
  if (parsed.ok !== true) {
    return { ok: false as const, status: 400, error: parsed.error };
  }

  const inserted = await recordPaymentWebhookEvent(supabaseAdmin, {
    provider,
    externalEventId: parsed.externalEventId,
    payload: parsed.payload,
  });
  if (!inserted) {
    return { ok: true as const, status: 200, duplicate: true };
  }

  const transaction = await getPaymentTransactionByExternalReference(
    supabaseAdmin,
    provider,
    parsed.externalReference
  );
  if (!transaction) {
    return { ok: false as const, status: 404, error: "payment_transaction_not_found" };
  }

  const updated = await applyTransactionStatusUpdate(
    supabaseAdmin,
    transaction,
    parsed.status,
    { provider_payload: parsed.payload }
  );

  return {
    ok: true as const,
    status: 200,
    payment_id: updated.id,
    payment_status: updated.status,
  };
}

export async function refreshPaymentStatus(
  supabaseAdmin: SupabaseClient,
  transaction: {
    id: string;
    provider: string;
    external_reference: string | null;
    status: string;
  },
  testMode = false
) {
  const provider = parsePaymentProvider(transaction.provider);
  if (!provider || !transaction.external_reference) {
    return { ok: false as const, error: "status_refresh_unsupported" };
  }

  const adapter = getPaymentProviderAdapter(provider);
  const remote = await adapter.fetchStatus(transaction.external_reference, testMode);
  if (remote.ok !== true) {
    return { ok: false as const, error: remote.error };
  }

  const current = await getPaymentTransactionById(supabaseAdmin, transaction.id);
  if (!current) return { ok: false as const, error: "payment_transaction_not_found" };

  const updated = await applyTransactionStatusUpdate(supabaseAdmin, current, remote.status, {
    provider_payload: remote.payload,
  });

  return { ok: true as const, payment: updated };
}
