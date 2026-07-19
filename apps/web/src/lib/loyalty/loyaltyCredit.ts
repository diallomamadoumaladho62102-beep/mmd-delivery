import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Crédit MMD (store credit) at checkout — reservation lifecycle helpers.
 *
 * Model: credit is a platform-funded discount.
 *   * reserve()  — HOLD before/at payment creation (authoritative, synchronous).
 *   * capture()  — finalize FIFO spend AFTER payment/order is confirmed paid.
 *   * release()  — free a HOLD when payment fails or the order is cancelled
 *                  before capture.
 *   * refund()   — re-credit a captured amount when a paid order is refunded.
 *   * reverse()  — write compensating negative loyalty-point entries on refund.
 *
 * capture/release/refund/reverse run AFTER the primary business operation has
 * already succeeded, so they must never throw. All exactly-once, currency and
 * balance rules live in the SECURITY DEFINER RPCs; here we only dispatch.
 */

export type CreditEntityType = "food_order" | "delivery_request" | "taxi_ride";

export interface ReserveCreditParams {
  userId: string;
  entityType: CreditEntityType;
  entityId: string;
  requestedCents: number;
  maxApplicableCents: number;
  currency: string;
}

export interface ReserveCreditResult {
  ok: boolean;
  amountCents: number;
  error?: string;
  availableCents?: number;
}

/**
 * Reserve MMD credit for an entity. Synchronous & authoritative — the caller
 * persists the returned `amountCents` as the applied credit and reduces the
 * charged amount by it. Returns amountCents=0 (ok:true) when nothing was held.
 */
export async function reserveEntityCredit(
  supabaseAdmin: SupabaseClient,
  params: ReserveCreditParams
): Promise<ReserveCreditResult> {
  const requested = Math.max(0, Math.round(Number(params.requestedCents) || 0));
  const maxApplicable = Math.max(0, Math.round(Number(params.maxApplicableCents) || 0));
  if (requested <= 0 || maxApplicable <= 0) {
    return { ok: true, amountCents: 0 };
  }
  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_credit_reserve", {
      p_user_id: params.userId,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_requested_cents: requested,
      p_max_applicable_cents: maxApplicable,
      p_currency: (params.currency || "USD").toUpperCase(),
    });
    if (error) {
      return { ok: false, amountCents: 0, error: error.message };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.ok === false) {
      return {
        ok: false,
        amountCents: 0,
        error: String(row.error ?? "reserve_failed"),
        availableCents: Number(row.available_cents ?? 0),
      };
    }
    return { ok: true, amountCents: Math.max(0, Number(row.amount_cents ?? 0)) };
  } catch (e) {
    return {
      ok: false,
      amountCents: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function dispatch(
  supabaseAdmin: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  ctx: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc(fn, args);
    if (error) {
      console.error(`[loyalty-credit] ${fn} rpc error`, { ...ctx, message: error.message });
    }
  } catch (e) {
    console.error(`[loyalty-credit] ${fn} threw (ignored)`, {
      ...ctx,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Finalize the reserved spend after payment confirmation (idempotent). */
export function captureEntityCredit(
  supabaseAdmin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string
): Promise<void> {
  const id = String(entityId ?? "").trim();
  if (!id) return Promise.resolve();
  return dispatch(
    supabaseAdmin,
    "mmd_credit_capture",
    { p_entity_type: entityType, p_entity_id: id },
    { entityType, entityId: id }
  );
}

/** Release a still-held reservation on failure/cancellation (idempotent). */
export function releaseEntityCredit(
  supabaseAdmin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string
): Promise<void> {
  const id = String(entityId ?? "").trim();
  if (!id) return Promise.resolve();
  return dispatch(
    supabaseAdmin,
    "mmd_credit_release",
    { p_entity_type: entityType, p_entity_id: id },
    { entityType, entityId: id }
  );
}

/** Re-credit a captured amount when a paid order/ride is refunded (idempotent). */
export function refundEntityCredit(
  supabaseAdmin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string,
  refundRef: string
): Promise<void> {
  const id = String(entityId ?? "").trim();
  if (!id) return Promise.resolve();
  return dispatch(
    supabaseAdmin,
    "mmd_credit_refund",
    { p_entity_type: entityType, p_entity_id: id, p_refund_ref: String(refundRef ?? "refund") },
    { entityType, entityId: id }
  );
}

const REVERSE_REFERENCE_TYPE: Record<CreditEntityType, string> = {
  food_order: "food_order",
  delivery_request: "delivery_request",
  taxi_ride: "taxi_ride",
};

/** Reverse awarded loyalty points on refund via compensating entries (idempotent). */
export function reverseEntityLoyalty(
  supabaseAdmin: SupabaseClient,
  entityType: CreditEntityType,
  entityId: string,
  reason?: string
): Promise<void> {
  const id = String(entityId ?? "").trim();
  if (!id) return Promise.resolve();
  return dispatch(
    supabaseAdmin,
    "mmd_loyalty_reverse",
    {
      p_reference_type: REVERSE_REFERENCE_TYPE[entityType],
      p_reference_id: id,
      p_reason: reason ?? null,
    },
    { entityType, entityId: id }
  );
}
