/**
 * Shared SCT reverse / recovery after customer refund (or reusable by disputes).
 * Architecture: separate charges + transfers — never invent destination/direct.
 *
 * Stripe SoT for money movement: transfers.createReversal when Connect balance
 * allows. If reverse fails (funds already Instant/bank paid out), persist
 * partner_transfer_recoveries with status=recovery_required — never mark
 * recovered artificially (status `recovered` is ops-only after real recovery).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  isBenignTransferReversalError,
  partnerClawbackIdempotencyKey,
} from "@/lib/finance/partnerTransferClawbackGuards";

export type PartnerClawbackEntityType =
  | "food_order"
  | "delivery_request"
  | "taxi_ride"
  | "food_tip"
  | "taxi_tip"
  | "seller_order";

export type PartnerTransferRef = {
  transferId: string;
  target: string;
  amountCentsHint?: number | null;
  currency?: string | null;
};

export type PartnerClawbackOutcome = {
  transferId: string;
  target: string;
  status:
    | "reversed"
    | "already_reversed"
    | "recovery_required"
    | "skipped";
  reversalId: string | null;
  amountCents: number;
  currency: string;
  errorCode: string | null;
  errorMessage: string | null;
  /** True when partner funds were not returned and ops recovery is required. */
  reconcile_required: boolean;
};

export type PartnerClawbackResult = {
  attempted: number;
  outcomes: PartnerClawbackOutcome[];
  reversed: string[];
  failed: string[];
  reconcile_required: boolean;
  cancelled_open_payouts: number;
};

export {
  isBenignTransferReversalError,
  partnerClawbackIdempotencyKey,
} from "@/lib/finance/partnerTransferClawbackGuards";

function asId(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function stripeErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  const type = (err as { type?: unknown }).type;
  const raw =
    typeof code === "string" && code.trim()
      ? code.trim()
      : typeof type === "string" && type.trim()
        ? type.trim()
        : null;
  return raw;
}

function stripeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return String(err ?? "unknown_error");
}

async function upsertRecoveryRow(
  supabaseAdmin: SupabaseClient,
  row: {
    entityType: PartnerClawbackEntityType;
    entityId: string;
    transferId: string;
    reversalId: string | null;
    refundId: string | null;
    disputeId: string | null;
    target: string;
    amountCents: number;
    currency: string;
    status: "reversed" | "already_reversed" | "recovery_required";
    failureCode: string | null;
    failureMessage: string | null;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ ok: boolean; reconcile_required: boolean }> {
  const now = new Date().toISOString();
  const payload = {
    entity_type: row.entityType,
    entity_id: row.entityId,
    stripe_transfer_id: row.transferId,
    stripe_reversal_id: row.reversalId,
    refund_id: row.refundId,
    dispute_id: row.disputeId,
    target: row.target,
    amount_cents: row.amountCents,
    currency: row.currency,
    status: row.status,
    failure_code: row.failureCode,
    failure_message: row.failureMessage,
    idempotency_key: row.idempotencyKey,
    metadata: row.metadata,
    updated_at: now,
  };

  const { error } = await supabaseAdmin
    .from("partner_transfer_recoveries")
    .upsert(payload, { onConflict: "idempotency_key" });

  if (error) {
    console.error("[partner-clawback] recovery upsert failed", {
      transferId: row.transferId,
      status: row.status,
      message: error.message,
    });
    // Stripe may have succeeded — never fail-open silently for reconcile path.
    return {
      ok: false,
      reconcile_required: true,
    };
  }

  return {
    ok: true,
    reconcile_required: row.status === "recovery_required",
  };
}

/**
 * Reverse one Connect Transfer or record recovery_required with exact amount.
 * Never writes status `recovered` — that is ops-only after confirmed recovery.
 */
export async function reverseStripeTransferOrRecover(params: {
  supabaseAdmin: SupabaseClient;
  stripeClient?: Stripe;
  entityType: PartnerClawbackEntityType;
  entityId: string;
  ref: PartnerTransferRef;
  source: string;
  correlationId: string;
  refundId?: string | null;
  disputeId?: string | null;
  reason: string;
}): Promise<PartnerClawbackOutcome> {
  const stripeClient = params.stripeClient ?? stripe;
  const transferId = asId(params.ref.transferId);
  if (!transferId) {
    return {
      transferId: "",
      target: params.ref.target,
      status: "skipped",
      reversalId: null,
      amountCents: 0,
      currency: "USD",
      errorCode: "missing_transfer_id",
      errorMessage: "missing_transfer_id",
      reconcile_required: false,
    };
  }

  const idempotencyKey = partnerClawbackIdempotencyKey({
    source: params.source,
    entityType: params.entityType,
    entityId: params.entityId,
    transferId,
    correlationId: params.correlationId,
  });

  // Idempotent short-circuit: never double-reverse when DB already recorded success.
  {
    const { data: prior } = await params.supabaseAdmin
      .from("partner_transfer_recoveries")
      .select("status, stripe_reversal_id, amount_cents, currency")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const priorStatus = String(
      (prior as { status?: string } | null)?.status ?? ""
    ).trim();
    if (priorStatus === "reversed" || priorStatus === "already_reversed") {
      return {
        transferId,
        target: params.ref.target,
        status: priorStatus as "reversed" | "already_reversed",
        reversalId: asId(
          (prior as { stripe_reversal_id?: string | null } | null)
            ?.stripe_reversal_id
        ),
        amountCents: Math.max(
          0,
          Math.round(
            Number(
              (prior as { amount_cents?: number } | null)?.amount_cents ??
                params.ref.amountCentsHint ??
                0
            )
          )
        ),
        currency:
          String(
            (prior as { currency?: string } | null)?.currency ?? "USD"
          ).toUpperCase() || "USD",
        errorCode: null,
        errorMessage: null,
        reconcile_required: false,
      };
    }
    // Never treat prior `recovered` as auto-retry target; ops owns that state.
    if (priorStatus === "recovered") {
      return {
        transferId,
        target: params.ref.target,
        status: "already_reversed",
        reversalId: asId(
          (prior as { stripe_reversal_id?: string | null } | null)
            ?.stripe_reversal_id
        ),
        amountCents: Math.max(
          0,
          Math.round(
            Number(
              (prior as { amount_cents?: number } | null)?.amount_cents ?? 0
            )
          )
        ),
        currency:
          String(
            (prior as { currency?: string } | null)?.currency ?? "USD"
          ).toUpperCase() || "USD",
        errorCode: null,
        errorMessage: null,
        reconcile_required: false,
      };
    }
  }

  let amountCents = Math.max(
    0,
    Math.round(Number(params.ref.amountCentsHint ?? 0))
  );
  let currency = String(params.ref.currency ?? "USD").toUpperCase() || "USD";
  let alreadyReversed = false;

  try {
    const existing = await stripeClient.transfers.retrieve(transferId);
    amountCents =
      amountCents > 0
        ? amountCents
        : Math.max(0, Math.round(Number(existing.amount ?? 0)));
    currency = String(existing.currency ?? currency).toUpperCase() || currency;
    const reversedFlag = Boolean((existing as { reversed?: boolean }).reversed);
    const amountReversed = Math.round(
      Number((existing as { amount_reversed?: number }).amount_reversed ?? 0)
    );
    if (
      reversedFlag ||
      (amountCents > 0 && amountReversed >= amountCents) ||
      (amountReversed > 0 &&
        amountReversed >= Math.round(Number(existing.amount ?? 0)))
    ) {
      alreadyReversed = true;
    }
  } catch (e) {
    console.warn("[partner-clawback] transfer retrieve fail-open", {
      transferId,
      message: stripeErrorMessage(e),
    });
  }

  if (alreadyReversed) {
    const persist = await upsertRecoveryRow(params.supabaseAdmin, {
      entityType: params.entityType,
      entityId: params.entityId,
      transferId,
      reversalId: null,
      refundId: params.refundId ?? null,
      disputeId: params.disputeId ?? null,
      target: params.ref.target,
      amountCents,
      currency,
      status: "already_reversed",
      failureCode: null,
      failureMessage: null,
      idempotencyKey,
      metadata: { reason: params.reason, source: params.source },
    });
    return {
      transferId,
      target: params.ref.target,
      status: "already_reversed",
      reversalId: null,
      amountCents,
      currency,
      errorCode: null,
      errorMessage: null,
      reconcile_required: persist.reconcile_required && !persist.ok,
    };
  }

  try {
    const reversal = await stripeClient.transfers.createReversal(
      transferId,
      {
        metadata: {
          entity_type: params.entityType,
          entity_id: params.entityId,
          reason: params.reason,
          source: params.source,
          refund_id: params.refundId ?? "",
          dispute_id: params.disputeId ?? "",
        },
      },
      { idempotencyKey }
    );

    const reversalId = asId(reversal.id);
    const persist = await upsertRecoveryRow(params.supabaseAdmin, {
      entityType: params.entityType,
      entityId: params.entityId,
      transferId,
      reversalId,
      refundId: params.refundId ?? null,
      disputeId: params.disputeId ?? null,
      target: params.ref.target,
      amountCents:
        amountCents > 0
          ? amountCents
          : Math.max(0, Math.round(Number(reversal.amount ?? 0))),
      currency,
      status: "reversed",
      failureCode: null,
      failureMessage: null,
      idempotencyKey,
      metadata: { reason: params.reason, source: params.source },
    });

    return {
      transferId,
      target: params.ref.target,
      status: "reversed",
      reversalId,
      amountCents,
      currency,
      errorCode: null,
      errorMessage: null,
      // Stripe OK + DB fail → still reconcile_required for ops.
      reconcile_required: !persist.ok,
    };
  } catch (e) {
    if (isBenignTransferReversalError(e)) {
      await upsertRecoveryRow(params.supabaseAdmin, {
        entityType: params.entityType,
        entityId: params.entityId,
        transferId,
        reversalId: null,
        refundId: params.refundId ?? null,
        disputeId: params.disputeId ?? null,
        target: params.ref.target,
        amountCents,
        currency,
        status: "already_reversed",
        failureCode: null,
        failureMessage: null,
        idempotencyKey,
        metadata: { reason: params.reason, source: params.source },
      });
      return {
        transferId,
        target: params.ref.target,
        status: "already_reversed",
        reversalId: null,
        amountCents,
        currency,
        errorCode: null,
        errorMessage: null,
        reconcile_required: false,
      };
    }

    const failureCode = stripeErrorCode(e) ?? "transfer_reversal_failed";
    const failureMessage = stripeErrorMessage(e);
    console.error("[partner-clawback] transfer reversal failed", {
      transferId,
      entityType: params.entityType,
      entityId: params.entityId,
      failureCode,
      failureMessage,
    });

    const persist = await upsertRecoveryRow(params.supabaseAdmin, {
      entityType: params.entityType,
      entityId: params.entityId,
      transferId,
      reversalId: null,
      refundId: params.refundId ?? null,
      disputeId: params.disputeId ?? null,
      target: params.ref.target,
      amountCents,
      currency,
      status: "recovery_required",
      failureCode,
      failureMessage,
      idempotencyKey,
      metadata: {
        reason: params.reason,
        source: params.source,
        note:
          "Stripe could not reverse SCT (often Connect balance already paid out via Instant or Sunday bank). Recovery required — do not treat refund as partner-settled.",
      },
    });
    if (!persist.ok) {
      console.error("[partner-clawback] recovery_required row persist failed", {
        transferId,
        entityId: params.entityId,
      });
    }

    return {
      transferId,
      target: params.ref.target,
      status: "recovery_required",
      reversalId: null,
      amountCents,
      currency,
      errorCode: failureCode,
      errorMessage: failureMessage,
      reconcile_required: true,
    };
  }
}

/** Persist recovery_required without attempting Stripe (caller already failed reverse). */
export async function recordFailedTransferRecovery(params: {
  supabaseAdmin: SupabaseClient;
  entityType: PartnerClawbackEntityType;
  entityId: string;
  transferId: string;
  target: string;
  amountCents?: number;
  currency?: string;
  refundId?: string | null;
  disputeId?: string | null;
  source: string;
  correlationId: string;
  failureCode: string | null;
  failureMessage: string;
  reason: string;
}): Promise<void> {
  const transferId = asId(params.transferId);
  if (!transferId) return;
  const idempotencyKey = partnerClawbackIdempotencyKey({
    source: params.source,
    entityType: params.entityType,
    entityId: params.entityId,
    transferId,
    correlationId: params.correlationId,
  });
  await upsertRecoveryRow(params.supabaseAdmin, {
    entityType: params.entityType,
    entityId: params.entityId,
    transferId,
    reversalId: null,
    refundId: params.refundId ?? null,
    disputeId: params.disputeId ?? null,
    target: params.target,
    amountCents: Math.max(0, Math.round(Number(params.amountCents ?? 0))),
    currency: String(params.currency ?? "USD").toUpperCase() || "USD",
    status: "recovery_required",
    failureCode: params.failureCode,
    failureMessage: params.failureMessage,
    idempotencyKey,
    metadata: { reason: params.reason, source: params.source },
  });
}

export async function cancelOpenFoodOrderPayouts(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("order_payouts")
    .update({
      status: "failed",
      failure_code: "refund_cancelled",
      failure_message: "Customer refund before or without live SCT",
      failed_at: now,
      updated_at: now,
    })
    .eq("order_id", orderId)
    .in("status", ["pending", "locked"])
    .is("stripe_transfer_id", null)
    .select("id");

  if (error) {
    console.warn(
      "[partner-clawback] cancel open order_payouts failed",
      error.message
    );
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function collectFoodOrderTransferRefs(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<PartnerTransferRef[]> {
  const refs = new Map<string, PartnerTransferRef>();
  const add = (
    transferId: unknown,
    target: string,
    amountCentsHint?: number | null,
    currency?: string | null
  ) => {
    const id = asId(transferId);
    if (!id) return;
    refs.set(id, {
      transferId: id,
      target,
      amountCentsHint: amountCentsHint ?? null,
      currency: currency ?? null,
    });
  };

  const { data: payoutRows } = await supabaseAdmin
    .from("order_payouts")
    .select("target, stripe_transfer_id, amount_cents, currency")
    .eq("order_id", orderId)
    .not("stripe_transfer_id", "is", null);

  for (const row of payoutRows ?? []) {
    const r = row as {
      target?: string | null;
      stripe_transfer_id?: string | null;
      amount_cents?: number | null;
      currency?: string | null;
    };
    add(r.stripe_transfer_id, r.target ?? "order", r.amount_cents, r.currency);
  }

  const { data: orderRow } = await supabaseAdmin
    .from("orders")
    .select(
      "driver_transfer_id, restaurant_transfer_id, tip_transfer_id, currency, driver_delivery_payout, restaurant_net_amount, tip_cents"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderRow) {
    const r = orderRow as {
      driver_transfer_id?: string | null;
      restaurant_transfer_id?: string | null;
      tip_transfer_id?: string | null;
      currency?: string | null;
      driver_delivery_payout?: number | null;
      restaurant_net_amount?: number | null;
      tip_cents?: number | null;
    };
    add(
      r.driver_transfer_id,
      "driver",
      r.driver_delivery_payout,
      r.currency
    );
    add(
      r.restaurant_transfer_id,
      "restaurant",
      r.restaurant_net_amount,
      r.currency
    );
    // Tip SCT is only reversed when the tip PaymentIntent itself is refunded
    // (food_tip / taxi_tip paths). Main-order refund must not claw tip.
    void r.tip_transfer_id;
  }

  return Array.from(refs.values());
}

async function collectTaxiRideTransferRefs(
  supabaseAdmin: SupabaseClient,
  rideId: string
): Promise<PartnerTransferRef[]> {
  const refs: PartnerTransferRef[] = [];

  const { data: commission } = await supabaseAdmin
    .from("taxi_commissions")
    .select("driver_transfer_id, driver_cents")
    .eq("taxi_ride_id", rideId)
    .maybeSingle();

  const fareTransfer = asId(
    (commission as { driver_transfer_id?: string | null } | null)
      ?.driver_transfer_id
  );
  if (fareTransfer) {
    refs.push({
      transferId: fareTransfer,
      target: "driver",
      amountCentsHint: Math.round(
        Number(
          (commission as { driver_cents?: number | null } | null)?.driver_cents ??
            0
        )
      ),
    });
  }

  return refs;
}

async function resolveDeliveryLinkedOrderId(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_ref_type", "delivery_request")
    .eq("external_ref_id", deliveryRequestId)
    .limit(1)
    .maybeSingle();
  return asId((data as { id?: string } | null)?.id);
}

/**
 * Clawback partner SCTs after a customer refund on the primary charge.
 * Does not reverse tip transfers (separate PI — use clawbackTipTransfersForRefund).
 */
export async function clawbackPartnerTransfersForRefund(params: {
  supabaseAdmin: SupabaseClient;
  stripeClient?: Stripe;
  entityType: "food_order" | "delivery_request" | "taxi_ride";
  entityId: string;
  refundId: string | null;
  reason: string;
}): Promise<PartnerClawbackResult> {
  const correlationId =
    asId(params.refundId) ?? `entity_${params.entityType}_${params.entityId}`;
  let cancelledOpen = 0;
  let refs: PartnerTransferRef[] = [];
  let clawbackEntityType: PartnerClawbackEntityType = params.entityType;
  let clawbackEntityId = params.entityId;

  if (params.entityType === "food_order") {
    cancelledOpen = await cancelOpenFoodOrderPayouts(
      params.supabaseAdmin,
      params.entityId
    );
    refs = await collectFoodOrderTransferRefs(
      params.supabaseAdmin,
      params.entityId
    );
  } else if (params.entityType === "delivery_request") {
    const linkedOrderId = await resolveDeliveryLinkedOrderId(
      params.supabaseAdmin,
      params.entityId
    );
    if (linkedOrderId) {
      cancelledOpen = await cancelOpenFoodOrderPayouts(
        params.supabaseAdmin,
        linkedOrderId
      );
      refs = await collectFoodOrderTransferRefs(
        params.supabaseAdmin,
        linkedOrderId
      );
      // Persist recovery against the order that holds transfer ids.
      clawbackEntityType = "food_order";
      clawbackEntityId = linkedOrderId;
    }
  } else if (params.entityType === "taxi_ride") {
    refs = await collectTaxiRideTransferRefs(
      params.supabaseAdmin,
      params.entityId
    );
  }

  const outcomes: PartnerClawbackOutcome[] = [];
  for (const ref of refs) {
    outcomes.push(
      await reverseStripeTransferOrRecover({
        supabaseAdmin: params.supabaseAdmin,
        stripeClient: params.stripeClient,
        entityType: clawbackEntityType,
        entityId: clawbackEntityId,
        ref,
        source: "customer_refund",
        correlationId,
        refundId: params.refundId,
        reason: params.reason,
      })
    );
  }

  const reversed = outcomes
    .filter((o) => o.status === "reversed" || o.status === "already_reversed")
    .map((o) => o.transferId)
    .filter(Boolean);
  const failed = outcomes
    .filter((o) => o.status === "recovery_required")
    .map((o) => o.transferId)
    .filter(Boolean);

  return {
    attempted: outcomes.length,
    outcomes,
    reversed,
    failed,
    reconcile_required: outcomes.some((o) => o.reconcile_required),
    cancelled_open_payouts: cancelledOpen,
  };
}

/**
 * Tip PaymentIntent refund → reverse tip SCT only (not fare/food transfers).
 */
export async function clawbackTipTransfersForRefund(params: {
  supabaseAdmin: SupabaseClient;
  stripeClient?: Stripe;
  refundId: string | null;
  reason: string;
  paymentIntentId: string;
}): Promise<PartnerClawbackResult> {
  const correlationId =
    asId(params.refundId) ?? `tip_pi_${params.paymentIntentId}`;
  const outcomes: PartnerClawbackOutcome[] = [];

  const { data: foodTips } = await params.supabaseAdmin
    .from("orders")
    .select("id, tip_transfer_id, tip_cents, currency")
    .eq("tip_payment_intent_id", params.paymentIntentId)
    .limit(20);

  for (const row of foodTips ?? []) {
    const orderId = asId((row as { id?: string }).id);
    const transferId = asId(
      (row as { tip_transfer_id?: string | null }).tip_transfer_id
    );
    if (!orderId || !transferId) continue;
    outcomes.push(
      await reverseStripeTransferOrRecover({
        supabaseAdmin: params.supabaseAdmin,
        stripeClient: params.stripeClient,
        entityType: "food_tip",
        entityId: orderId,
        ref: {
          transferId,
          target: "driver_tip",
          amountCentsHint: Math.round(
            Number((row as { tip_cents?: number | null }).tip_cents ?? 0)
          ),
          currency: String(
            (row as { currency?: string | null }).currency ?? "USD"
          ),
        },
        source: "tip_refund",
        correlationId,
        refundId: params.refundId,
        reason: params.reason,
      })
    );
  }

  const { data: taxiTips } = await params.supabaseAdmin
    .from("taxi_rides")
    .select("id, tip_transfer_id, tip_cents, currency")
    .eq("tip_payment_intent_id", params.paymentIntentId)
    .limit(20);

  for (const row of taxiTips ?? []) {
    const rideId = asId((row as { id?: string }).id);
    const transferId = asId(
      (row as { tip_transfer_id?: string | null }).tip_transfer_id
    );
    if (!rideId || !transferId) continue;
    outcomes.push(
      await reverseStripeTransferOrRecover({
        supabaseAdmin: params.supabaseAdmin,
        stripeClient: params.stripeClient,
        entityType: "taxi_tip",
        entityId: rideId,
        ref: {
          transferId,
          target: "taxi_driver_tip",
          amountCentsHint: Math.round(
            Number((row as { tip_cents?: number | null }).tip_cents ?? 0)
          ),
          currency: String(
            (row as { currency?: string | null }).currency ?? "USD"
          ),
        },
        source: "tip_refund",
        correlationId,
        refundId: params.refundId,
        reason: params.reason,
      })
    );
  }

  const reversed = outcomes
    .filter((o) => o.status === "reversed" || o.status === "already_reversed")
    .map((o) => o.transferId)
    .filter(Boolean);
  const failed = outcomes
    .filter((o) => o.status === "recovery_required")
    .map((o) => o.transferId)
    .filter(Boolean);

  return {
    attempted: outcomes.length,
    outcomes,
    reversed,
    failed,
    reconcile_required: outcomes.some((o) => o.reconcile_required),
    cancelled_open_payouts: 0,
  };
}
