import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/**
 * Shared lease for all payment-expiration entrypoints
 * (`/api/orders/expire-unpaid` alias + `/api/cron/expire-stale-payments`).
 * Prevents concurrent local cancel of the same order/DR rows.
 */
export const PAYMENT_EXPIRATION_LOCK_JOB = "payment-expiration";

/** @deprecated Use PAYMENT_EXPIRATION_LOCK_JOB — kept for log/job labeling only. */
export const EXPIRE_STALE_PAYMENTS_JOB = PAYMENT_EXPIRATION_LOCK_JOB;

/**
 * Responsibilities:
 * - Canonical owner: `/api/cron/expire-stale-payments` (orders + delivery_requests + safe Stripe PI cancel).
 * - Compatibility alias: `/api/orders/expire-unpaid` delegates to the same runner + shared lock.
 * - Neither path may run concurrently with the other (shared `payment-expiration` lock).
 */

/** Extra grace after expires_at before local cancel / Stripe cancel. */
export const EXPIRE_SAFETY_MARGIN_MS = 15 * 60 * 1000;

export const EXPIRE_BATCH_LIMIT = 100;

/** PI statuses that may be canceled after local expiry. */
export const CANCELABLE_PI_STATUSES = new Set([
  "requires_payment_method",
  "canceled",
]);

/** Never cancel these — payment may be settling or already captured. */
export const NEVER_CANCEL_PI_STATUSES = new Set([
  "succeeded",
  "processing",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
]);

export type StalePaymentEntityType = "order" | "delivery_request";

export type StalePaymentRow = {
  id: string;
  entityType: StalePaymentEntityType;
  status: string | null;
  payment_status: string | null;
  expires_at: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

export type ExpireStalePaymentsSummary = {
  ok: true;
  dry_run: boolean;
  scanned: number;
  canceled_local: number;
  stripe_pi_canceled: number;
  stripe_pi_skipped: number;
  stripe_pi_already_canceled: number;
  errors: number;
  details: Array<Record<string, unknown>>;
  partial?: boolean;
  stopped_reason?: string | null;
};

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isExpiredWithMargin(
  expiresAt: unknown,
  nowMs: number,
  marginMs = EXPIRE_SAFETY_MARGIN_MS
): boolean {
  const iso = String(expiresAt ?? "").trim();
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms + marginMs < nowMs;
}

export function isCancelablePaymentStatus(paymentStatus: unknown): boolean {
  const s = lower(paymentStatus);
  return s === "unpaid" || s === "processing";
}

export function decideStripePiAction(
  stripeStatus: string | null | undefined
): "cancel" | "skip_succeeded" | "skip_in_progress" | "already_canceled" | "skip_unknown" {
  const status = lower(stripeStatus);
  if (!status) return "skip_unknown";
  if (status === "canceled") return "already_canceled";
  if (NEVER_CANCEL_PI_STATUSES.has(status)) {
    if (status === "succeeded") return "skip_succeeded";
    return "skip_in_progress";
  }
  if (CANCELABLE_PI_STATUSES.has(status)) return "cancel";
  return "skip_unknown";
}

function isTerminalOrderStatus(status: unknown): boolean {
  const s = lower(status);
  return s === "delivered" || s === "ready" || s === "canceled" || s === "cancelled";
}

export function shouldExpireLocally(
  row: StalePaymentRow,
  nowMs: number
): boolean {
  if (!row.id) return false;
  if (!isCancelablePaymentStatus(row.payment_status)) return false;
  if (!isExpiredWithMargin(row.expires_at, nowMs)) return false;

  if (row.entityType === "order") {
    return !isTerminalOrderStatus(row.status);
  }

  const status = lower(row.status);
  return (
    status === "pending" ||
    status === "paid_pending" ||
    status === "processing_pending" ||
    status === ""
  );
}

async function loadStaleOrders(
  supabaseAdmin: SupabaseClient,
  cutoffIso: string,
  limit: number
): Promise<StalePaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, status, payment_status, expires_at, stripe_session_id, stripe_payment_intent_id"
    )
    .in("payment_status", ["unpaid", "processing"])
    .not("expires_at", "is", null)
    .lt("expires_at", cutoffIso)
    .limit(limit);

  if (error) throw new Error(`orders_select_failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    entityType: "order" as const,
    status: row.status ?? null,
    payment_status: row.payment_status ?? null,
    expires_at: row.expires_at ?? null,
    stripe_session_id: row.stripe_session_id ?? null,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
  }));
}

async function loadStaleDeliveryRequests(
  supabaseAdmin: SupabaseClient,
  cutoffIso: string,
  limit: number
): Promise<StalePaymentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, status, payment_status, expires_at, stripe_session_id, stripe_payment_intent_id"
    )
    .in("payment_status", ["unpaid", "processing"])
    .not("expires_at", "is", null)
    .lt("expires_at", cutoffIso)
    .limit(limit);

  if (error) throw new Error(`delivery_requests_select_failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    entityType: "delivery_request" as const,
    status: row.status ?? null,
    payment_status: row.payment_status ?? null,
    expires_at: row.expires_at ?? null,
    stripe_session_id: row.stripe_session_id ?? null,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
  }));
}

/**
 * Atomic claim: update returns claimed rows. If another worker already
 * canceled/paid the row, returned count is 0 and we skip double-processing.
 */
export async function claimCancelLocalEntity(
  supabaseAdmin: SupabaseClient,
  row: StalePaymentRow,
  nowIso: string,
  dryRun: boolean
): Promise<"claimed" | "already_processed" | "dry_run"> {
  if (dryRun) return "dry_run";

  const table = row.entityType === "order" ? "orders" : "delivery_requests";
  const { data, error } = await supabaseAdmin
    .from(table)
    .update({
      status: "canceled",
      payment_status: "unpaid",
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .in("payment_status", ["unpaid", "processing"])
    .select("id");

  if (error) throw new Error(`${table}_cancel_failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return "already_processed";
  return "claimed";
}

async function cancelStripePaymentIntentIfSafe(
  stripe: Stripe,
  paymentIntentId: string,
  dryRun: boolean,
  retrieve: (id: string) => Promise<Stripe.PaymentIntent>
): Promise<"canceled" | "already_canceled" | "skipped_succeeded" | "skipped_in_progress" | "skipped_unknown"> {
  const pi = await retrieve(paymentIntentId);
  const action = decideStripePiAction(pi.status);

  if (action === "already_canceled") return "already_canceled";
  if (action === "skip_succeeded") return "skipped_succeeded";
  if (action === "skip_in_progress") return "skipped_in_progress";
  if (action !== "cancel") return "skipped_unknown";

  if (!dryRun) {
    try {
      await stripe.paymentIntents.cancel(paymentIntentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already.*?cancel/i.test(message) || /resource_missing/i.test(message)) {
        return "already_canceled";
      }
      throw error;
    }
  }

  return "canceled";
}

export async function runExpireStalePayments(opts: {
  supabaseAdmin: SupabaseClient;
  stripe: Stripe | null;
  dryRun?: boolean;
  now?: Date;
  limit?: number;
  startedMs?: number;
  budgetMs?: number;
  onPhase?: (
    phase:
      | "supabase_query_started"
      | "supabase_query_finished"
      | "stripe_retrieve_started"
      | "stripe_retrieve_finished"
      | "processing_started"
      | "processing_finished"
      | "job_deadline_reached"
      | "vercel_deadline_approaching",
    detail?: Record<string, unknown>
  ) => void;
  retrievePaymentIntent?: (id: string) => Promise<Stripe.PaymentIntent>;
}): Promise<ExpireStalePaymentsSummary> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const startedMs = opts.startedMs ?? Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const limitRaw = Number(opts.limit ?? EXPIRE_BATCH_LIMIT);
  const limit = Math.min(
    EXPIRE_BATCH_LIMIT,
    Math.max(0, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : EXPIRE_BATCH_LIMIT)
  );

  const cutoffIso = new Date(nowMs - EXPIRE_SAFETY_MARGIN_MS).toISOString();

  opts.onPhase?.("supabase_query_started", { batch_size: limit });
  const [orders, deliveryRequests] = await Promise.all([
    limit === 0
      ? Promise.resolve([] as StalePaymentRow[])
      : loadStaleOrders(opts.supabaseAdmin, cutoffIso, limit),
    limit === 0
      ? Promise.resolve([] as StalePaymentRow[])
      : loadStaleDeliveryRequests(opts.supabaseAdmin, cutoffIso, limit),
  ]);
  opts.onPhase?.("supabase_query_finished", {
    orders: orders.length,
    delivery_requests: deliveryRequests.length,
  });

  const candidates = [...orders, ...deliveryRequests]
    .filter((row) => shouldExpireLocally(row, nowMs))
    .slice(0, limit);

  const summary: ExpireStalePaymentsSummary = {
    ok: true,
    dry_run: dryRun,
    scanned: orders.length + deliveryRequests.length,
    canceled_local: 0,
    stripe_pi_canceled: 0,
    stripe_pi_skipped: 0,
    stripe_pi_already_canceled: 0,
    errors: 0,
    details: [],
    partial: false,
    stopped_reason: null,
  };

  opts.onPhase?.("processing_started", { eligible: candidates.length });

  const retrieve =
    opts.retrievePaymentIntent ??
    ((id: string) => opts.stripe!.paymentIntents.retrieve(id));

  for (const row of candidates) {
    if (Date.now() - startedMs >= budgetMs) {
      summary.partial = true;
      summary.stopped_reason = "job_deadline_reached";
      opts.onPhase?.("job_deadline_reached", {
        processed: summary.canceled_local,
      });
      break;
    }
    if (Date.now() - startedMs >= budgetMs - 3_000) {
      opts.onPhase?.("vercel_deadline_approaching");
    }

    const detail: Record<string, unknown> = {
      entity_type: row.entityType,
      entity_id: row.id,
      expires_at: row.expires_at,
    };

    try {
      const piId = String(row.stripe_payment_intent_id ?? "").trim();
      if (piId && opts.stripe) {
        opts.onPhase?.("stripe_retrieve_started", {
          resource_ref: piId.slice(0, 8) + "…",
        });
        const stripeResult = await cancelStripePaymentIntentIfSafe(
          opts.stripe,
          piId,
          dryRun,
          retrieve
        );
        opts.onPhase?.("stripe_retrieve_finished", {
          action: stripeResult,
        });
        detail.stripe_pi_action = stripeResult;

        if (
          stripeResult === "skipped_succeeded" ||
          stripeResult === "skipped_in_progress"
        ) {
          summary.stripe_pi_skipped += 1;
          detail.skipped_local = true;
          summary.details.push(detail);
          continue;
        }
        if (stripeResult === "already_canceled") {
          summary.stripe_pi_already_canceled += 1;
        }
        if (stripeResult === "canceled") {
          summary.stripe_pi_canceled += 1;
        }
      }

      const claim = await claimCancelLocalEntity(
        opts.supabaseAdmin,
        row,
        nowIso,
        dryRun
      );
      detail.local_claim = claim;
      if (claim === "already_processed") {
        detail.skipped_local = true;
        summary.details.push(detail);
        continue;
      }
      summary.canceled_local += 1;
      detail.local_canceled = true;
    } catch (error) {
      summary.errors += 1;
      detail.error = error instanceof Error ? error.message : String(error);
      console.error("[expireStalePayments] row failed", {
        entity_type: row.entityType,
        entity_id: String(row.id).slice(0, 8) + "…",
        error: detail.error,
      });
    }

    summary.details.push(detail);
  }

  opts.onPhase?.("processing_finished", {
    canceled_local: summary.canceled_local,
    partial: summary.partial === true,
  });

  return summary;
}
