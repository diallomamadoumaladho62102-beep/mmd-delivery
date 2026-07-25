import type { SupabaseClient } from "@supabase/supabase-js";
import { applyTransactionStatusUpdate } from "@/lib/paymentEntityCompletion";
import { getPaymentProviderAdapter, parsePaymentProvider } from "@/lib/paymentProviders";
import {
  getPaymentTransactionByExternalReference,
  getPaymentTransactionById,
} from "@/lib/paymentTransactionService";

/** After this age, a `processing` webhook claim is considered abandoned and may be reclaimed. */
export const WEBHOOK_PROCESSING_STALE_SECONDS = 300;

type ClaimOutcome =
  | "claimed"
  | "already_processed"
  | "in_progress"
  | "invalid"
  | "missing";

type ClaimResult = {
  ok: boolean;
  outcome: ClaimOutcome;
  id?: string;
  status?: string;
  attempt_count?: number;
  error?: string;
};

/**
 * Never trust a provider webhook "paid" claim alone.
 * Re-confirm with the provider status API before marking money as settled.
 *
 * Recoverable state machine:
 * - New / retryable / failed / stale processing → claim → settle → processed
 * - Already processed → no second settlement
 * - Fresh in-progress claim → do not double-process
 */
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

  const claim = await claimPaymentWebhookEvent(supabaseAdmin, {
    provider,
    externalEventId: parsed.externalEventId,
    payload: parsed.payload,
    staleSeconds: WEBHOOK_PROCESSING_STALE_SECONDS,
  });

  if (claim.outcome === "already_processed") {
    return {
      ok: true as const,
      status: 200,
      duplicate: true,
      webhook_status: "processed" as const,
    };
  }

  if (claim.outcome === "in_progress") {
    // Another worker holds a fresh claim — non-2xx so providers retry.
    return {
      ok: false as const,
      status: 503,
      error: "webhook_in_progress",
      deferred: true,
      webhook_status: "processing" as const,
    };
  }

  if (claim.outcome !== "claimed" || !claim.id) {
    return {
      ok: false as const,
      status: 500,
      error: claim.error ?? "webhook_claim_failed",
    };
  }

  const eventId = claim.id;

  try {
    const transaction = await getPaymentTransactionByExternalReference(
      supabaseAdmin,
      provider,
      parsed.externalReference
    );
    if (!transaction) {
      await finalizePaymentWebhookEvent(supabaseAdmin, {
        eventId,
        outcome: "retryable",
        lastError: "payment_transaction_not_found",
      });
      return { ok: false as const, status: 404, error: "payment_transaction_not_found" };
    }

    let nextStatus = parsed.status;

    // Critical: forged "paid" webhooks must not settle money without provider confirmation.
    if (nextStatus === "paid") {
      if (!transaction.external_reference) {
        await finalizePaymentWebhookEvent(supabaseAdmin, {
          eventId,
          outcome: "failed",
          paymentTransactionId: transaction.id,
          lastError: "missing_external_reference_on_transaction",
        });
        return {
          ok: false as const,
          status: 400,
          error: "missing_external_reference_on_transaction",
        };
      }
      const remote = await adapter.fetchStatus(transaction.external_reference, false);
      if (remote.ok !== true) {
        await finalizePaymentWebhookEvent(supabaseAdmin, {
          eventId,
          outcome: "retryable",
          paymentTransactionId: transaction.id,
          lastError: remote.error ?? "provider_status_unavailable",
        });
        return {
          ok: false as const,
          status: 502,
          error: remote.error ?? "provider_status_unavailable",
        };
      }
      if (remote.status !== "paid") {
        nextStatus =
          remote.status === "failed" ||
          remote.status === "canceled" ||
          remote.status === "expired"
            ? remote.status
            : "processing";
      }
    }

    const updated = await applyTransactionStatusUpdate(
      supabaseAdmin,
      transaction,
      nextStatus,
      { provider_payload: parsed.payload }
    );

    await finalizePaymentWebhookEvent(supabaseAdmin, {
      eventId,
      outcome: "processed",
      paymentTransactionId: updated.id,
    });

    return {
      ok: true as const,
      status: 200,
      payment_id: updated.id,
      payment_status: updated.status,
      webhook_status: "processed" as const,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "webhook_settlement_failed";
    await finalizePaymentWebhookEvent(supabaseAdmin, {
      eventId,
      outcome: "retryable",
      lastError: message,
    });
    return { ok: false as const, status: 503, error: message };
  }
}

export async function claimPaymentWebhookEvent(
  supabaseAdmin: SupabaseClient,
  input: {
    provider: string;
    externalEventId: string;
    payload: Record<string, unknown>;
    staleSeconds?: number;
  },
): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin.rpc("claim_payment_webhook_event", {
    p_provider: input.provider,
    p_external_event_id: input.externalEventId,
    p_payload: input.payload,
    p_stale_seconds: input.staleSeconds ?? WEBHOOK_PROCESSING_STALE_SECONDS,
  });

  if (error) {
    const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
    const isProductionRuntime =
      appEnv === "production" || process.env.NODE_ENV === "production";
    // Production must use the atomic RPC claim — non-atomic fallback risks double settlement.
    if (isProductionRuntime) {
      return {
        ok: false,
        outcome: "invalid",
        error:
          "claim_payment_webhook_event RPC required in production (non-atomic claim fallback disabled)",
      };
    }
    // Fallback for local/dev environments where migration is not yet applied.
    return claimPaymentWebhookEventFallback(supabaseAdmin, input);
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: payload.ok !== false,
    outcome: String(payload.outcome ?? "invalid") as ClaimOutcome,
    id: payload.id ? String(payload.id) : undefined,
    status: payload.status ? String(payload.status) : undefined,
    attempt_count:
      typeof payload.attempt_count === "number"
        ? payload.attempt_count
        : undefined,
    error: payload.error ? String(payload.error) : undefined,
  };
}

export async function finalizePaymentWebhookEvent(
  supabaseAdmin: SupabaseClient,
  input: {
    eventId: string;
    outcome: "processed" | "failed" | "retryable";
    paymentTransactionId?: string | null;
    lastError?: string | null;
    retryAfterSeconds?: number;
  },
) {
  const { error } = await supabaseAdmin.rpc("finalize_payment_webhook_event", {
    p_event_id: input.eventId,
    p_outcome: input.outcome,
    p_payment_transaction_id: input.paymentTransactionId ?? null,
    p_last_error: input.lastError ?? null,
    p_retry_after_seconds: input.retryAfterSeconds ?? 60,
  });

  if (error) {
    const appEnv = String(process.env.APP_ENV ?? process.env.VERCEL_ENV ?? "").toLowerCase();
    const isProductionRuntime =
      appEnv === "production" || process.env.NODE_ENV === "production";
    if (isProductionRuntime) {
      throw new Error(
        "finalize_payment_webhook_event RPC required in production (non-atomic finalize fallback disabled)",
      );
    }
    await finalizePaymentWebhookEventFallback(supabaseAdmin, input);
  }
}

/** In-memory / pre-migration fallback: status columns may be absent. */
async function claimPaymentWebhookEventFallback(
  supabaseAdmin: SupabaseClient,
  input: {
    provider: string;
    externalEventId: string;
    payload: Record<string, unknown>;
    staleSeconds?: number;
  },
): Promise<ClaimResult> {
  const staleMs = (input.staleSeconds ?? WEBHOOK_PROCESSING_STALE_SECONDS) * 1000;
  const now = Date.now();

  const { data: existing, error: selectError } = await supabaseAdmin
    .from("payment_webhook_events")
    .select("*")
    .eq("provider", input.provider)
    .eq("external_event_id", input.externalEventId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, outcome: "invalid", error: selectError.message };
  }

  if (!existing) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("payment_webhook_events")
      .insert({
        provider: input.provider,
        external_event_id: input.externalEventId,
        payload: input.payload,
        status: "processing",
        processing_started_at: new Date(now).toISOString(),
        attempt_count: 1,
      })
      .select("*")
      .single();

    if (insertError?.code === "23505") {
      return claimPaymentWebhookEventFallback(supabaseAdmin, input);
    }
    if (insertError || !inserted) {
      return {
        ok: false,
        outcome: "invalid",
        error: insertError?.message ?? "webhook_insert_failed",
      };
    }
    return {
      ok: true,
      outcome: "claimed",
      id: String(inserted.id),
      status: "processing",
      attempt_count: Number(inserted.attempt_count ?? 1),
    };
  }

  const status = String(existing.status ?? "received");
  if (status === "processed") {
    return {
      ok: true,
      outcome: "already_processed",
      id: String(existing.id),
      status,
      attempt_count: Number(existing.attempt_count ?? 0),
    };
  }

  const startedAt = existing.processing_started_at
    ? Date.parse(String(existing.processing_started_at))
    : 0;
  if (status === "processing" && startedAt && now - startedAt < staleMs) {
    return {
      ok: true,
      outcome: "in_progress",
      id: String(existing.id),
      status,
      attempt_count: Number(existing.attempt_count ?? 0),
    };
  }

  const nextAttempt = Number(existing.attempt_count ?? 0) + 1;
  const { data: claimed, error: updateError } = await supabaseAdmin
    .from("payment_webhook_events")
    .update({
      status: "processing",
      processing_started_at: new Date(now).toISOString(),
      attempt_count: nextAttempt,
      last_error: null,
      payload: input.payload,
      next_retry_at: null,
    })
    .eq("id", existing.id)
    .in("status", ["received", "failed", "retryable", "processing"])
    .select("*")
    .maybeSingle();

  if (updateError) {
    return { ok: false, outcome: "invalid", error: updateError.message };
  }
  if (!claimed) {
    return {
      ok: true,
      outcome: "in_progress",
      id: String(existing.id),
      status: "processing",
    };
  }

  return {
    ok: true,
    outcome: "claimed",
    id: String(claimed.id),
    status: "processing",
    attempt_count: Number(claimed.attempt_count ?? nextAttempt),
  };
}

async function finalizePaymentWebhookEventFallback(
  supabaseAdmin: SupabaseClient,
  input: {
    eventId: string;
    outcome: "processed" | "failed" | "retryable";
    paymentTransactionId?: string | null;
    lastError?: string | null;
    retryAfterSeconds?: number;
  },
) {
  const patch: Record<string, unknown> = {
    status: input.outcome,
    last_error: input.lastError ?? null,
  };
  if (input.paymentTransactionId) {
    patch.payment_transaction_id = input.paymentTransactionId;
  }
  if (input.outcome === "processed") {
    patch.processed_at = new Date().toISOString();
    patch.next_retry_at = null;
  } else if (input.outcome === "retryable") {
    const retrySec = Math.max(5, input.retryAfterSeconds ?? 60);
    patch.next_retry_at = new Date(Date.now() + retrySec * 1000).toISOString();
  } else {
    patch.next_retry_at = null;
  }

  const { error } = await supabaseAdmin
    .from("payment_webhook_events")
    .update(patch)
    .eq("id", input.eventId);
  if (error) throw new Error(error.message);
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
