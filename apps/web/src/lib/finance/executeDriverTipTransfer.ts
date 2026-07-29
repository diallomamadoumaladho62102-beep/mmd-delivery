import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { appendWalletLedgerEntry } from "@/lib/payoutTransactionService";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import {
  buildDriverTipTransferIdempotencyKey,
  buildDriverTipTransferParams,
} from "@/lib/finance/tipMoneyArchitecture";

type TipOrderRow = {
  id: string;
  driver_id: string | null;
  status: string | null;
  currency: string | null;
  tip_cents: number | null;
  tip_paid_out: boolean | null;
  tip_transfer_id: string | null;
  tip_payment_intent_id: string | null;
  tip_stripe_charge_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

type DriverProfileRow = {
  user_id: string | null;
  stripe_account_id: string | null;
};

export type ExecuteDriverTipTransferResult =
  | {
      ok: true;
      already_transferred: boolean;
      order_id: string;
      transfer_id: string;
      amount_cents: number;
    }
  | { ok: false; error: string };

const TIP_ORDER_SELECT =
  "id, driver_id, status, currency, tip_cents, tip_paid_out, tip_transfer_id, tip_payment_intent_id, tip_stripe_charge_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function chargeIdFromPaymentIntent(pi: {
  latest_charge?: unknown;
}): string | null {
  const charge = pi.latest_charge;
  if (isNonEmptyString(charge)) return charge.trim();
  if (charge && typeof charge === "object" && "id" in charge) {
    const id = (charge as { id?: unknown }).id;
    if (isNonEmptyString(id)) return id.trim();
  }
  return null;
}

/**
 * Resolve the tip's own Stripe charge id.
 * Prefers the persisted `tip_stripe_charge_id` column; falls back to a live
 * PaymentIntent retrieve + metadata check (order_id / kind=driver_tip) when
 * the column is empty — e.g. a webhook retry racing the DB write, or an
 * environment where the column migration has not landed yet.
 */
async function resolveTipChargeId(
  order: TipOrderRow,
  tipPaymentIntentId: string | null
): Promise<{ chargeId: string | null; paymentIntentId: string | null }> {
  if (order.tip_stripe_charge_id) {
    return {
      chargeId: order.tip_stripe_charge_id,
      paymentIntentId: order.tip_payment_intent_id ?? tipPaymentIntentId ?? null,
    };
  }

  const piId = order.tip_payment_intent_id ?? tipPaymentIntentId ?? null;
  if (!piId) return { chargeId: null, paymentIntentId: null };

  const pi = await stripe.paymentIntents.retrieve(piId, {
    expand: ["latest_charge"],
  });

  const metadata = (pi.metadata ?? {}) as Record<string, unknown>;
  const metadataOrderId = String(metadata.order_id ?? "").trim();
  const metadataKind = String(metadata.kind ?? "").trim().toLowerCase();

  if (metadataOrderId && metadataOrderId !== order.id) {
    throw new Error("tip_payment_intent_order_mismatch");
  }
  if (metadataKind && metadataKind !== "driver_tip") {
    throw new Error("tip_payment_intent_kind_mismatch");
  }
  if (String(pi.status ?? "").toLowerCase() !== "succeeded") {
    throw new Error("tip_payment_intent_not_succeeded");
  }

  return { chargeId: chargeIdFromPaymentIntent(pi), paymentIntentId: pi.id };
}

/**
 * Move a delivered order's tip (100%) to the driver's Connect account via a
 * dedicated Stripe Transfer, funded by the tip's own charge. See
 * `@/lib/finance/tipMoneyArchitecture` for the full business rule. Idempotent:
 * safe to call again after the transfer already succeeded.
 */
export async function executeDriverTipTransfer(
  supabaseAdmin: SupabaseClient,
  params: { orderId: string; tipPaymentIntentId?: string | null }
): Promise<ExecuteDriverTipTransferResult> {
  const orderId = String(params.orderId ?? "").trim();
  if (!orderId) return { ok: false, error: "order_id_required" };

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(TIP_ORDER_SELECT)
    .eq("id", orderId)
    .maybeSingle<TipOrderRow>();

  if (orderErr) return { ok: false, error: orderErr.message };
  if (!order) return { ok: false, error: "order_not_found" };

  if (order.tip_paid_out === true && isNonEmptyString(order.tip_transfer_id)) {
    return {
      ok: true,
      already_transferred: true,
      order_id: order.id,
      transfer_id: order.tip_transfer_id,
      amount_cents: Math.max(0, Math.round(Number(order.tip_cents ?? 0))),
    };
  }

  if (String(order.status ?? "").toLowerCase() !== "delivered") {
    return { ok: false, error: "order_not_delivered" };
  }

  const tipCents = Math.max(0, Math.round(Number(order.tip_cents ?? 0)));
  if (tipCents <= 0) {
    return { ok: false, error: "tip_cents_not_positive" };
  }

  if (!order.driver_id) {
    return { ok: false, error: "order_missing_driver" };
  }

  const tipPaymentIntentId = params.tipPaymentIntentId?.trim() || null;
  if (
    tipPaymentIntentId &&
    order.tip_payment_intent_id &&
    order.tip_payment_intent_id !== tipPaymentIntentId
  ) {
    return { ok: false, error: "tip_payment_intent_mismatch" };
  }

  let chargeId: string | null;
  let resolvedPaymentIntentId: string | null;
  try {
    const resolved = await resolveTipChargeId(order, tipPaymentIntentId);
    chargeId = resolved.chargeId;
    resolvedPaymentIntentId = resolved.paymentIntentId;
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "tip_charge_resolution_failed",
    };
  }

  if (!chargeId) {
    return { ok: false, error: "tip_charge_not_found" };
  }

  const { data: driver, error: driverErr } = await supabaseAdmin
    .from("driver_profiles")
    .select("user_id, stripe_account_id")
    .eq("user_id", order.driver_id)
    .maybeSingle<DriverProfileRow>();

  if (driverErr) return { ok: false, error: driverErr.message };
  if (!driver?.stripe_account_id) {
    return { ok: false, error: "driver_payout_account_missing" };
  }

  const destination = String(driver.stripe_account_id).trim();
  if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
    return { ok: false, error: "invalid_driver_payout_destination" };
  }

  const transferParams = buildDriverTipTransferParams({
    tipCents,
    tipChargeId: chargeId,
    destinationAccountId: destination,
    currency: order.currency ?? "usd",
    orderId: order.id,
  });
  const idempotencyKey = buildDriverTipTransferIdempotencyKey(order.id);

  const transfer = await stripe.transfers.create(transferParams, {
    idempotencyKey,
  });

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({
      tip_transfer_id: transfer.id,
      tip_paid_out: true,
      tip_transferred_at: nowIso,
      tip_stripe_charge_id: chargeId,
      tip_payment_intent_id: order.tip_payment_intent_id ?? resolvedPaymentIntentId,
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .eq("tip_paid_out", false)
    .is("tip_transfer_id", null)
    .select("id")
    .maybeSingle();

  if (updateErr) {
    // Stripe transfer already succeeded — never swallow this. Ops must
    // reconcile using the idempotency key (safe to retry: same transfer).
    console.error("[executeDriverTipTransfer] order update failed after transfer", {
      order_id: order.id,
      transfer_id: transfer.id,
      error: updateErr.message,
    });
    return { ok: false, error: "tip_transfer_created_but_order_update_failed" };
  }

  if (!updated) {
    console.error("[executeDriverTipTransfer] order tip state already advanced (race)", {
      order_id: order.id,
      transfer_id: transfer.id,
    });
  }

  const countryCode = resolveOrderPlatformCountry(order);

  try {
    await appendWalletLedgerEntry(supabaseAdmin, {
      accountType: "driver",
      accountUserId: order.driver_id,
      countryCode,
      currency: String(order.currency ?? "USD").toUpperCase(),
      direction: "credit",
      amountCents: tipCents,
      referenceType: "adjustment",
      referenceId: order.id,
      description: `Driver tip for order ${order.id}`,
      metadata: {
        source: "execute_driver_tip_transfer",
        order_id: order.id,
        stripe_transfer_id: transfer.id,
        tip_stripe_charge_id: chargeId,
      },
    });
    await appendWalletLedgerEntry(supabaseAdmin, {
      accountType: "platform",
      accountUserId: null,
      countryCode,
      currency: String(order.currency ?? "USD").toUpperCase(),
      direction: "debit",
      amountCents: tipCents,
      referenceType: "adjustment",
      referenceId: order.id,
      description: `Driver tip disbursement for order ${order.id}`,
      metadata: {
        source: "execute_driver_tip_transfer",
        order_id: order.id,
        stripe_transfer_id: transfer.id,
      },
    });
  } catch (e) {
    console.warn(
      "[executeDriverTipTransfer] wallet ledger write fail-open",
      order.id,
      e instanceof Error ? e.message : e
    );
  }

  return {
    ok: true,
    already_transferred: false,
    order_id: order.id,
    transfer_id: transfer.id,
    amount_cents: tipCents,
  };
}
