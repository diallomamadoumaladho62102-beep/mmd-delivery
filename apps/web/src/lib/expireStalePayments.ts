import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export const EXPIRE_STALE_PAYMENTS_JOB = "expire-stale-payments";

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

  // delivery_request: cancel only while still awaiting payment visibility
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

async function cancelLocalEntity(
  supabaseAdmin: SupabaseClient,
  row: StalePaymentRow,
  nowIso: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;

  if (row.entityType === "order") {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({
        status: "canceled",
        payment_status: "unpaid",
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .neq("payment_status", "paid");
    if (error) throw new Error(`order_cancel_failed: ${error.message}`);
    return;
  }

  const { error } = await supabaseAdmin
    .from("delivery_requests")
    .update({
      status: "canceled",
      payment_status: "unpaid",
      updated_at: nowIso,
    })
    .eq("id", row.id)
    .neq("payment_status", "paid");
  if (error) throw new Error(`delivery_request_cancel_failed: ${error.message}`);
}

async function cancelStripePaymentIntentIfSafe(
  stripe: Stripe,
  paymentIntentId: string,
  dryRun: boolean
): Promise<"canceled" | "already_canceled" | "skipped_succeeded" | "skipped_in_progress" | "skipped_unknown"> {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
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
      // Tolerate races where Stripe already canceled.
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
}): Promise<ExpireStalePaymentsSummary> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const limit = Math.min(
    EXPIRE_BATCH_LIMIT,
    Math.max(1, Number(opts.limit ?? EXPIRE_BATCH_LIMIT) || EXPIRE_BATCH_LIMIT)
  );

  // Select rows whose expires_at is older than (now - margin) already applied in filter:
  // expires_at < now - margin  <=>  expires_at + margin < now
  const cutoffIso = new Date(nowMs - EXPIRE_SAFETY_MARGIN_MS).toISOString();

  const [orders, deliveryRequests] = await Promise.all([
    loadStaleOrders(opts.supabaseAdmin, cutoffIso, limit),
    loadStaleDeliveryRequests(opts.supabaseAdmin, cutoffIso, limit),
  ]);

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
  };

  for (const row of candidates) {
    const detail: Record<string, unknown> = {
      entity_type: row.entityType,
      entity_id: row.id,
      expires_at: row.expires_at,
    };

    try {
      // Re-check Stripe BEFORE local cancel when a PI exists, to avoid racing a late settle.
      const piId = String(row.stripe_payment_intent_id ?? "").trim();
      if (piId && opts.stripe) {
        const stripeResult = await cancelStripePaymentIntentIfSafe(
          opts.stripe,
          piId,
          dryRun
        );
        detail.stripe_pi_action = stripeResult;

        if (stripeResult === "skipped_succeeded" || stripeResult === "skipped_in_progress") {
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

      await cancelLocalEntity(opts.supabaseAdmin, row, nowIso, dryRun);
      summary.canceled_local += 1;
      detail.local_canceled = true;
    } catch (error) {
      summary.errors += 1;
      detail.error = error instanceof Error ? error.message : String(error);
      console.error("[expireStalePayments] row failed", detail);
    }

    summary.details.push(detail);
  }

  return summary;
}
