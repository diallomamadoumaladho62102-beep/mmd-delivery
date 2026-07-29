import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

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

async function findEntityByPaymentIntentOrCharge(
  supabaseAdmin: SupabaseClient,
  paymentIntentId: string | null,
  _chargeId: string | null
): Promise<MatchedEntity | null> {
  const tables: DisputeEntityTable[] = [
    "orders",
    "delivery_requests",
    "taxi_rides",
    "seller_orders",
  ];

  for (const table of tables) {
    if (!paymentIntentId) continue;

    const selectCols =
      table === "orders"
        ? "id, stripe_payment_intent_id, client_user_id, user_id, created_by"
        : "id, stripe_payment_intent_id, client_user_id";

    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectCols)
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1)
      .maybeSingle();

    if (error || !data) continue;

    const row = data as Record<string, unknown>;
    const clientUserId = String(
      row.client_user_id ?? row.user_id ?? row.created_by ?? ""
    ).trim();

    return {
      table,
      id: String(row.id),
      clientUserId: clientUserId || null,
      entityType: entityTypeForTable(table),
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

  return {
    ok: true,
    finance_dispute_id: upserted?.id ? String(upserted.id) : null,
    entity,
  };
}
