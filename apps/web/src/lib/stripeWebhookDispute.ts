import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { reverseInboundPaymentWalletEntries } from "@/lib/inboundWalletBridge";
import { getPaymentTransactionByExternalReference } from "@/lib/paymentTransactionService";
import type { PaymentTransactionRow } from "@/lib/paymentTypes";

type DisputeEntityTable =
  | "orders"
  | "delivery_requests"
  | "taxi_rides"
  | "seller_orders";

type MatchedEntity = {
  table: DisputeEntityTable;
  id: string;
  clientUserId: string | null;
  entityType: string;
};

function paymentIntentIdFromCharge(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent;
  if (typeof pi === "string" && pi.trim()) return pi.trim();
  if (pi && typeof pi === "object" && "id" in pi && typeof pi.id === "string") {
    return pi.id.trim();
  }
  return null;
}

function chargeIdFromDispute(dispute: Stripe.Dispute): string | null {
  const charge = dispute.charge;
  if (typeof charge === "string" && charge.trim()) return charge.trim();
  if (charge && typeof charge === "object" && "id" in charge) {
    return String((charge as { id?: string }).id ?? "").trim() || null;
  }
  return null;
}

function mapFinanceDisputeStatus(
  stripeStatus: string | null | undefined
): "warning" | "needs_response" | "under_review" | "won" | "lost" | "closed" {
  const s = String(stripeStatus ?? "").trim().toLowerCase();
  if (s === "won") return "won";
  if (s === "lost" || s === "charge_refunded") return "lost";
  if (s === "warning_closed") return "closed";
  if (s === "warning_needs_response" || s === "needs_response") return "needs_response";
  if (s === "warning_under_review" || s === "under_review") return "under_review";
  if (s.startsWith("warning")) return "warning";
  return "needs_response";
}

function entityTypeForTable(table: DisputeEntityTable): string {
  if (table === "orders") return "food_order";
  if (table === "delivery_requests") return "delivery_request";
  if (table === "taxi_rides") return "taxi_ride";
  return "seller_order";
}

function clientUserIdFromRow(row: Record<string, unknown>): string | null {
  const id = String(
    row.client_user_id ?? row.user_id ?? row.created_by ?? ""
  ).trim();
  return id || null;
}

async function findEntityByPaymentIntentOrCharge(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string | null,
  _chargeId: string | null
): Promise<MatchedEntity | null> {
  if (!paymentIntentId) return null;

  // Fixed select strings per table — Supabase typed client rejects dynamic
  // ternary union select lists (ParserError → TS2352 on cast).
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, stripe_payment_intent_id, client_user_id, user_id, created_by")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (!orderErr && order) {
    const row = order as unknown as Record<string, unknown>;
    return {
      table: "orders",
      id: String(row.id),
      clientUserId: clientUserIdFromRow(row),
      entityType: entityTypeForTable("orders"),
    };
  }

  const { data: delivery, error: deliveryErr } = await supabaseAdmin
    .from("delivery_requests")
    .select("id, stripe_payment_intent_id, client_user_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (!deliveryErr && delivery) {
    const row = delivery as unknown as Record<string, unknown>;
    return {
      table: "delivery_requests",
      id: String(row.id),
      clientUserId: clientUserIdFromRow(row),
      entityType: entityTypeForTable("delivery_requests"),
    };
  }

  const { data: taxi, error: taxiErr } = await supabaseAdmin
    .from("taxi_rides")
    .select("id, stripe_payment_intent_id, client_user_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (!taxiErr && taxi) {
    const row = taxi as unknown as Record<string, unknown>;
    return {
      table: "taxi_rides",
      id: String(row.id),
      clientUserId: clientUserIdFromRow(row),
      entityType: entityTypeForTable("taxi_rides"),
    };
  }

  const { data: seller, error: sellerErr } = await supabaseAdmin
    .from("seller_orders")
    .select("id, stripe_payment_intent_id, client_user_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (!sellerErr && seller) {
    const row = seller as unknown as Record<string, unknown>;
    return {
      table: "seller_orders",
      id: String(row.id),
      clientUserId: clientUserIdFromRow(row),
      entityType: entityTypeForTable("seller_orders"),
    };
  }

  return null;
}

async function applyEntityRefundStatusForDispute(
  supabaseAdmin: SupabaseClient,
  entity: MatchedEntity,
  financeStatus: ReturnType<typeof mapFinanceDisputeStatus>
): Promise<void> {
  let nextRefund: string | null = "disputed";
  if (financeStatus === "won") {
    nextRefund = null;
  } else if (financeStatus === "closed") {
    // Closed without explicit loss — leave disputed marker cleared if previously won path,
    // otherwise keep disputed for operational visibility.
    nextRefund = null;
  } else if (financeStatus === "lost") {
    nextRefund = "disputed";
  }

  const patch: Record<string, unknown> = {
    refund_status: nextRefund,
  };

  // Active dispute windows always mark disputed.
  if (
    financeStatus === "needs_response" ||
    financeStatus === "under_review" ||
    financeStatus === "warning"
  ) {
    patch.refund_status = "disputed";
  }

  const { error } = await supabaseAdmin
    .from(entity.table)
    .update(patch)
    .eq("id", entity.id);

  if (error) {
    // stripe_charge_id may be missing on some tables — already handled in lookup fail-open.
    console.warn(
      "[stripeWebhookDispute] entity refund_status update failed",
      entity.table,
      error.message
    );
  }
}

type DisputeTransferRef = {
  transferId: string;
  target: string;
};

/**
 * Resolve every Stripe Connect Transfer already paid out for a disputed
 * entity, from the canonical per-vertical payout tables (never re-derived —
 * these are the same tables `transfers/run`, `transfers/taxi-run` and
 * `executeMarketplacePayouts` write `stripe_transfer_id` into).
 * `delivery_requests` has no dedicated per-entity transfer table today
 * (driver payouts for that vertical are batched via `driver_payouts`, not
 * linked 1:1 to a request), so it intentionally returns no refs.
 */
async function findTransferIdsForDisputeEntity(
  supabaseAdmin: SupabaseClient,
  entity: MatchedEntity
): Promise<DisputeTransferRef[]> {
  const refs = new Map<string, DisputeTransferRef>();

  const add = (transferId: unknown, target: string) => {
    const id = String(transferId ?? "").trim();
    if (id) refs.set(id, { transferId: id, target });
  };

  if (entity.table === "orders") {
    const { data: payoutRows, error: payoutErr } = await supabaseAdmin
      .from("order_payouts")
      .select("target, stripe_transfer_id")
      .eq("order_id", entity.id)
      .eq("status", "succeeded");

    if (payoutErr) {
      console.warn(
        "[stripeWebhookDispute] order_payouts lookup fail-open",
        payoutErr.message
      );
    } else {
      for (const row of payoutRows ?? []) {
        const r = row as { target?: string | null; stripe_transfer_id?: string | null };
        add(r.stripe_transfer_id, r.target ?? "order");
      }
    }

    const { data: orderRow, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("driver_transfer_id, restaurant_transfer_id")
      .eq("id", entity.id)
      .maybeSingle();

    if (orderErr) {
      console.warn(
        "[stripeWebhookDispute] orders transfer id lookup fail-open",
        orderErr.message
      );
    } else if (orderRow) {
      const r = orderRow as {
        driver_transfer_id?: string | null;
        restaurant_transfer_id?: string | null;
      };
      add(r.driver_transfer_id, "driver");
      add(r.restaurant_transfer_id, "restaurant");
    }
  }

  if (entity.table === "taxi_rides") {
    const { data: taxiRow, error: taxiErr } = await supabaseAdmin
      .from("taxi_rides")
      .select("driver_transfer_id")
      .eq("id", entity.id)
      .maybeSingle();

    if (taxiErr) {
      console.warn(
        "[stripeWebhookDispute] taxi_rides transfer id lookup fail-open",
        taxiErr.message
      );
    } else if (taxiRow) {
      add((taxiRow as { driver_transfer_id?: string | null }).driver_transfer_id, "driver");
    }
  }

  if (entity.table === "seller_orders") {
    const { data: sellerPayouts, error: sellerErr } = await supabaseAdmin
      .from("marketplace_seller_payouts")
      .select("stripe_transfer_id")
      .eq("seller_order_id", entity.id)
      .not("stripe_transfer_id", "is", null);

    if (sellerErr) {
      console.warn(
        "[stripeWebhookDispute] marketplace_seller_payouts lookup fail-open",
        sellerErr.message
      );
    } else {
      for (const row of sellerPayouts ?? []) {
        add((row as { stripe_transfer_id?: string | null }).stripe_transfer_id, "seller");
      }
    }

    const { data: driverPayouts, error: driverErr } = await supabaseAdmin
      .from("marketplace_driver_payouts")
      .select("stripe_transfer_id")
      .eq("seller_order_id", entity.id)
      .not("stripe_transfer_id", "is", null);

    if (driverErr) {
      console.warn(
        "[stripeWebhookDispute] marketplace_driver_payouts lookup fail-open",
        driverErr.message
      );
    } else {
      for (const row of driverPayouts ?? []) {
        add((row as { stripe_transfer_id?: string | null }).stripe_transfer_id, "driver");
      }
    }
  }

  return Array.from(refs.values());
}

/**
 * Lost-dispute clawback: reverse every Stripe Connect Transfer already paid
 * out for the disputed entity. Fail-open per transfer (console.warn) but
 * attempts every ref found — a single unreversable transfer must never block
 * the others. Idempotent via a per-(dispute, transfer) idempotency key, so
 * webhook retries never double-reverse.
 */
async function clawbackDisputeTransfers(params: {
  supabaseAdmin: SupabaseClient;
  stripe: Stripe;
  disputeId: string;
  entity: MatchedEntity;
}): Promise<{ attempted: number; reversed: string[]; failed: string[] }> {
  const refs = await findTransferIdsForDisputeEntity(
    params.supabaseAdmin,
    params.entity
  );

  const reversed: string[] = [];
  const failed: string[] = [];

  for (const ref of refs) {
    try {
      await params.stripe.transfers.createReversal(
        ref.transferId,
        {},
        { idempotencyKey: `dispute_clawback_${params.disputeId}_${ref.transferId}` }
      );
      reversed.push(ref.transferId);
    } catch (e) {
      failed.push(ref.transferId);
      console.warn(
        "[stripeWebhookDispute] transfer reversal fail-open",
        ref.transferId,
        ref.target,
        e instanceof Error ? e.message : e
      );
    }
  }

  return { attempted: refs.length, reversed, failed };
}

/**
 * Mirror of stripeWebhookChargeRefunded's inbound-wallet reversal for a lost
 * dispute. Fail-open (console.warn): the entity refund_status + Connect
 * transfer reversal are the primary compensating actions.
 */
async function reverseInboundWalletForDispute(
  supabaseAdmin: SupabaseClient,
  params: { paymentIntentId: string | null; disputeId: string; amountCents: number }
): Promise<void> {
  if (!params.paymentIntentId || params.amountCents <= 0) return;

  let transaction: PaymentTransactionRow | null = null;
  try {
    transaction = await getPaymentTransactionByExternalReference(
      supabaseAdmin,
      "stripe",
      params.paymentIntentId
    );
  } catch (e) {
    console.warn(
      "[stripeWebhookDispute] wallet reverse lookup fail-open",
      e instanceof Error ? e.message : e
    );
    return;
  }

  if (!transaction) return;

  try {
    await reverseInboundPaymentWalletEntries(supabaseAdmin, {
      transaction,
      refundId: `dispute_${params.disputeId}`,
      amountCents: params.amountCents,
    });
  } catch (e) {
    console.warn(
      "[stripeWebhookDispute] reverse_inbound_payment_wallet_entries fail-open",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Upsert finance_disputes and mark related entity refund_status for Charge disputes.
 */
export async function syncStripeChargeDispute(params: {
  supabaseAdmin: SupabaseClient;
  dispute: Stripe.Dispute;
  eventType: string;
  stripe?: Stripe;
}): Promise<{
  ok: boolean;
  finance_dispute_id: string | null;
  entity: MatchedEntity | null;
  skipped?: string;
  clawback?: { attempted: number; reversed: string[]; failed: string[] } | null;
}> {
  const { supabaseAdmin, dispute, eventType } = params;
  const disputeId = String(dispute.id ?? "").trim();
  if (!disputeId) {
    return { ok: false, finance_dispute_id: null, entity: null, skipped: "missing_dispute_id" };
  }

  const chargeId = chargeIdFromDispute(dispute);
  let paymentIntentId: string | null =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent.trim()
      : dispute.payment_intent &&
          typeof dispute.payment_intent === "object" &&
          "id" in dispute.payment_intent
        ? String((dispute.payment_intent as { id?: string }).id ?? "").trim() || null
        : null;

  if (!paymentIntentId && chargeId && params.stripe) {
    try {
      const charge = await params.stripe.charges.retrieve(chargeId);
      paymentIntentId = paymentIntentIdFromCharge(charge);
    } catch (e) {
      console.warn(
        "[stripeWebhookDispute] charge retrieve fail-open",
        e instanceof Error ? e.message : e
      );
    }
  }

  const entity = await findEntityByPaymentIntentOrCharge(
    supabaseAdmin,
    paymentIntentId,
    chargeId
  );

  const financeStatus = mapFinanceDisputeStatus(dispute.status);
  const amountCents = Math.max(0, Math.round(Number(dispute.amount ?? 0)));
  const currency = String(dispute.currency ?? "usd").toUpperCase();
  const dueBy =
    typeof dispute.evidence_details?.due_by === "number"
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null;

  const metadata = {
    event_type: eventType,
    stripe_status: dispute.status ?? null,
    charge_id: chargeId,
    payment_intent_id: paymentIntentId,
    reason: dispute.reason ?? null,
  };

  const row = {
    provider: "stripe",
    provider_dispute_id: disputeId,
    payment_ref: paymentIntentId ?? chargeId,
    client_user_id: entity?.clientUserId ?? null,
    entity_type: entity?.entityType ?? null,
    entity_id: entity?.id ?? null,
    amount_cents: amountCents,
    currency,
    reason: dispute.reason ?? null,
    status: financeStatus,
    due_by: dueBy,
    fee_cents: 0,
    amount_lost_cents: financeStatus === "lost" ? amountCents : 0,
    amount_recovered_cents: financeStatus === "won" ? amountCents : 0,
    metadata,
    updated_at: new Date().toISOString(),
  };

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("finance_disputes")
    .upsert(row, { onConflict: "provider,provider_dispute_id" })
    .select("id")
    .maybeSingle();

  if (upsertErr) {
    throw new Error(`finance_disputes upsert failed: ${upsertErr.message}`);
  }

  if (entity) {
    await applyEntityRefundStatusForDispute(supabaseAdmin, entity, financeStatus);
  }

  let clawback: { attempted: number; reversed: string[]; failed: string[] } | null = null;

  if (financeStatus === "lost" && entity && params.stripe) {
    clawback = await clawbackDisputeTransfers({
      supabaseAdmin,
      stripe: params.stripe,
      disputeId,
      entity,
    });

    await reverseInboundWalletForDispute(supabaseAdmin, {
      paymentIntentId,
      disputeId,
      amountCents,
    });
  }

  return {
    ok: true,
    finance_dispute_id: upserted?.id ? String(upserted.id) : null,
    entity,
    clawback,
  };
}
