import type { SupabaseClient } from "@supabase/supabase-js";
import {
  financeIdempotencyKey,
  type FinanceEnqueueInput,
} from "@/lib/finance/financeTypes";

/** Fail-safe enqueue: never throws to callers of payment flows. */
export async function enqueueFinanceEvent(
  supabaseAdmin: SupabaseClient,
  input: FinanceEnqueueInput
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_finance_enqueue_event", {
      p_source_type: input.sourceType,
      p_source_id: input.sourceId,
      p_event_type: input.eventType,
      p_idempotency_key: input.idempotencyKey,
      p_payload: input.payload ?? {},
      p_occurred_at: input.occurredAt ?? new Date().toISOString(),
      p_vertical: input.vertical ?? null,
      p_country_code: input.countryCode ?? null,
      p_currency: input.currency ?? "USD",
      p_correlation_id: input.correlationId ?? null,
    });
    if (error) {
      console.warn("[finance] enqueue failed", error.message);
      return { ok: false, error: error.message };
    }
    return (data ?? { ok: true }) as Record<string, unknown>;
  } catch (e) {
    console.warn(
      "[finance] enqueue threw",
      e instanceof Error ? e.message : e
    );
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function processFinancePendingBatch(
  supabaseAdmin: SupabaseClient,
  limit = 100
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_finance_process_pending_batch",
    { p_limit: Math.max(1, Math.min(limit, 500)) }
  );
  if (error) return { ok: false, error: error.message };
  return (data ?? {}) as Record<string, unknown>;
}

export async function refreshFinanceBalances(
  supabaseAdmin: SupabaseClient,
  asOf?: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc("mmd_finance_refresh_balances", {
    p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? {}) as Record<string, unknown>;
}

export async function enqueuePaymentSucceeded(params: {
  supabaseAdmin: SupabaseClient;
  entityType: string;
  entityId: string;
  vertical: "food" | "delivery" | "taxi" | "marketplace";
  amountCents: number;
  currency?: string | null;
  countryCode?: string | null;
  commissionCents?: number;
  partnerCents?: number;
  taxCents?: number;
  serviceFeeCents?: number;
  providerFeeCents?: number;
  partnerUserId?: string | null;
  paymentIntentId?: string | null;
}) {
  const eventType =
    params.vertical === "food"
      ? "food_paid"
      : params.vertical === "delivery"
        ? "delivery_paid"
        : params.vertical === "taxi"
          ? "taxi_paid"
          : "marketplace_paid";

  let payload: Record<string, unknown> = {
    amount_cents: params.amountCents,
    gross_cents: params.amountCents,
    commission_cents: params.commissionCents ?? 0,
    partner_cents: params.partnerCents ?? 0,
    tax_cents: params.taxCents ?? 0,
    service_fee_cents: params.serviceFeeCents ?? 0,
    provider_fee_cents: params.providerFeeCents ?? 0,
    partner_user_id: params.partnerUserId ?? null,
    description: `${params.vertical} payment ${params.entityId}`,
  };
  let countryCode = params.countryCode ?? null;
  let currency = params.currency ?? "USD";

  try {
    const { buildFinancePayloadFromSnapshot } = await import(
      "@/lib/finance/financePayloadFromSnapshot"
    );
    const snap = await buildFinancePayloadFromSnapshot({
      supabaseAdmin: params.supabaseAdmin,
      vertical: params.vertical,
      entityId: params.entityId,
      fallbackAmountCents: params.amountCents,
      paymentIntentId: params.paymentIntentId,
    });
    payload = {
      ...snap,
      provider_fee_cents:
        params.providerFeeCents ?? snap.provider_fee_cents ?? 0,
      legal_entity: snap.legal_entity,
      correlation_id: snap.correlation_id,
    };
    countryCode = snap.country_code ?? countryCode;
    currency = snap.currency || currency;
  } catch (e) {
    console.warn(
      "[finance] snapshot enrich fail-open",
      e instanceof Error ? e.message : e
    );
  }

  return enqueueFinanceEvent(params.supabaseAdmin, {
    sourceType: params.entityType,
    sourceId: params.entityId,
    eventType,
    idempotencyKey: financeIdempotencyKey([
      "payment",
      params.vertical,
      params.entityId,
      params.paymentIntentId ?? "paid",
    ]),
    vertical: params.vertical,
    countryCode,
    currency,
    correlationId: params.paymentIntentId ?? params.entityId,
    payload,
  });
}

export function enqueueRefundEvent(params: {
  supabaseAdmin: SupabaseClient;
  entityType: string;
  entityId: string;
  vertical: string;
  amountCents: number;
  currency?: string | null;
  refundId?: string | null;
}) {
  return enqueueFinanceEvent(params.supabaseAdmin, {
    sourceType: params.entityType,
    sourceId: params.entityId,
    eventType: "refund_succeeded",
    idempotencyKey: financeIdempotencyKey([
      "refund",
      params.vertical,
      params.entityId,
      params.refundId ?? "refund",
    ]),
    vertical: params.vertical,
    currency: params.currency ?? "USD",
    correlationId: params.refundId ?? params.entityId,
    payload: {
      amount_cents: params.amountCents,
      gross_cents: params.amountCents,
      description: `Refund ${params.entityId}`,
    },
  });
}
