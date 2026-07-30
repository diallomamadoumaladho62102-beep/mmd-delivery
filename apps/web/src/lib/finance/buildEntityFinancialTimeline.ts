import type { SupabaseClient } from "@supabase/supabase-js";
import {
  filterFinancialEventsForRole,
  sortFinancialEventsDesc,
  type FinancialActorRole,
  type FinancialEntityType,
  type FinancialTimelineEvent,
} from "@/lib/finance/financialTimelineTypes";

/**
 * Build a role-filtered financial timeline for a single entity.
 * Uses existing tables — no mocks. Admin sees full internal refs.
 */
export async function buildEntityFinancialTimeline(
  supabaseAdmin: SupabaseClient,
  params: {
    entityType: FinancialEntityType;
    entityId: string;
    role: FinancialActorRole;
    limit?: number;
  }
): Promise<FinancialTimelineEvent[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const events: FinancialTimelineEvent[] = [];
  const { entityType, entityId } = params;

  if (entityType === "taxi_ride") {
    const { data: ride } = await supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,total_cents,currency,payment_status,refund_status,stripe_payment_intent_id,stripe_refund_id,tip_cents,tip_transfer_id,tip_paid_out,mmd_credit_applied_cents,discount_cents,loyalty_discount_cents,paid_at,created_at,updated_at,payment_funding"
      )
      .eq("id", entityId)
      .maybeSingle();

    if (ride) {
      const currency = String(ride.currency ?? "USD");
      if (ride.paid_at || ride.payment_status === "paid") {
        events.push({
          id: `taxi_pay_${ride.id}`,
          kind: "payment_intent",
          status: String(ride.payment_status ?? "paid"),
          amount_cents: Math.round(Number(ride.total_cents ?? 0)),
          currency,
          direction: "debit",
          title_key: "finance.event.payment",
          title_fallback: "Payment",
          subtitle:
            ride.payment_funding === "business_wallet"
              ? "Business wallet"
              : undefined,
          entity_type: "taxi_ride",
          entity_id: entityId,
          occurred_at: String(ride.paid_at ?? ride.created_at),
          references: {
            payment_intent_id: ride.stripe_payment_intent_id
              ? String(ride.stripe_payment_intent_id)
              : null,
          },
        });
      }
      if (Number(ride.mmd_credit_applied_cents ?? 0) > 0) {
        events.push({
          id: `taxi_credit_${ride.id}`,
          kind: "credit",
          status: "applied",
          amount_cents: Math.round(Number(ride.mmd_credit_applied_cents)),
          currency,
          direction: "credit",
          title_key: "finance.event.wallet_credit",
          title_fallback: "Wallet credit",
          entity_type: "taxi_ride",
          entity_id: entityId,
          occurred_at: String(ride.paid_at ?? ride.created_at),
        });
      }
      if (Number(ride.tip_cents ?? 0) > 0) {
        events.push({
          id: `taxi_tip_${ride.id}`,
          kind: "tip",
          status: ride.tip_paid_out ? "paid" : "pending",
          amount_cents: Math.round(Number(ride.tip_cents)),
          currency,
          direction: "debit",
          title_key: "finance.event.tip",
          title_fallback: "Tip",
          entity_type: "taxi_ride",
          entity_id: entityId,
          occurred_at: String(ride.updated_at ?? ride.created_at),
          references: {
            transfer_id: ride.tip_transfer_id
              ? String(ride.tip_transfer_id)
              : null,
          },
        });
      }
      if (
        ride.refund_status &&
        ["refunded", "partially_refunded", "full_refund_required"].includes(
          String(ride.refund_status)
        )
      ) {
        events.push({
          id: `taxi_refund_${ride.id}`,
          kind: "refund",
          status: String(ride.refund_status),
          amount_cents: Math.round(Number(ride.total_cents ?? 0)),
          currency,
          direction: "credit",
          title_key: "finance.event.refund",
          title_fallback: "Refund",
          entity_type: "taxi_ride",
          entity_id: entityId,
          occurred_at: String(ride.updated_at ?? ride.created_at),
          references: {
            refund_id: ride.stripe_refund_id
              ? String(ride.stripe_refund_id)
              : null,
          },
        });
      }

      const { data: commissions } = await supabaseAdmin
        .from("taxi_commissions")
        .select(
          "id,driver_cents,platform_cents,driver_transfer_id,driver_paid_out,updated_at,created_at"
        )
        .eq("taxi_ride_id", entityId)
        .limit(5);

      for (const c of commissions ?? []) {
        events.push({
          id: `taxi_comm_${c.id}`,
          kind: "commission",
          status: c.driver_paid_out ? "paid" : "pending",
          amount_cents: Math.round(Number(c.driver_cents ?? 0)),
          currency,
          direction: "credit",
          title_key: "finance.event.driver_commission",
          title_fallback: "Driver commission",
          entity_type: "taxi_ride",
          entity_id: entityId,
          occurred_at: String(c.updated_at ?? c.created_at),
          references: {
            transfer_id: c.driver_transfer_id
              ? String(c.driver_transfer_id)
              : null,
          },
          metadata: {
            platform_cents: c.platform_cents,
          },
        });
        if (c.driver_transfer_id) {
          events.push({
            id: `taxi_xfer_${c.id}`,
            kind: "transfer",
            status: "paid",
            amount_cents: Math.round(Number(c.driver_cents ?? 0)),
            currency,
            direction: "credit",
            title_key: "finance.event.stripe_transfer",
            title_fallback: "Stripe Connect transfer",
            entity_type: "taxi_ride",
            entity_id: entityId,
            occurred_at: String(c.updated_at ?? c.created_at),
            references: {
              transfer_id: String(c.driver_transfer_id),
            },
          });
        }
      }
    }
  }

  if (entityType === "seller_order") {
    const { data: order } = await supabaseAdmin
      .from("seller_orders")
      .select(
        "id,total_cents,currency,payment_status,refund_status,stripe_payment_intent_id,stripe_refund_id,stripe_charge_id,paid_at,created_at,updated_at"
      )
      .eq("id", entityId)
      .maybeSingle();

    if (order) {
      const currency = String(order.currency ?? "USD");
      if (order.payment_status === "paid") {
        events.push({
          id: `mkt_pay_${order.id}`,
          kind: "payment_intent",
          status: "paid",
          amount_cents: Math.round(Number(order.total_cents ?? 0)),
          currency,
          direction: "debit",
          title_key: "finance.event.payment",
          title_fallback: "Payment",
          entity_type: "seller_order",
          entity_id: entityId,
          occurred_at: String(order.paid_at ?? order.created_at),
          references: {
            payment_intent_id: order.stripe_payment_intent_id
              ? String(order.stripe_payment_intent_id)
              : null,
            charge_id: order.stripe_charge_id
              ? String(order.stripe_charge_id)
              : null,
          },
        });
      }
      if (order.refund_status) {
        events.push({
          id: `mkt_refund_${order.id}`,
          kind: "refund",
          status: String(order.refund_status),
          amount_cents: Math.round(Number(order.total_cents ?? 0)),
          currency,
          direction: "credit",
          title_key: "finance.event.refund",
          title_fallback: "Refund",
          entity_type: "seller_order",
          entity_id: entityId,
          occurred_at: String(order.updated_at ?? order.created_at),
          references: {
            refund_id: order.stripe_refund_id
              ? String(order.stripe_refund_id)
              : null,
          },
        });
      }
    }

    const { data: payouts } = await supabaseAdmin
      .from("marketplace_seller_payouts")
      .select(
        "id,seller_net_amount_cents,platform_fee_cents,currency,status,stripe_transfer_id,created_at,updated_at"
      )
      .eq("seller_order_id", entityId)
      .limit(10);

    for (const p of payouts ?? []) {
      events.push({
        id: `mkt_payout_${p.id}`,
        kind: "payout",
        status: String(p.status ?? "pending"),
        amount_cents: Math.round(Number(p.seller_net_amount_cents ?? 0)),
        currency: String(p.currency ?? "USD"),
        direction: "credit",
        title_key: "finance.event.seller_payout",
        title_fallback: "Seller payout",
        entity_type: "seller_order",
        entity_id: entityId,
        occurred_at: String(p.updated_at ?? p.created_at),
        references: {
          transfer_id: p.stripe_transfer_id
            ? String(p.stripe_transfer_id)
            : null,
        },
        metadata: { platform_fee_cents: p.platform_fee_cents },
      });
      if (Number(p.platform_fee_cents ?? 0) > 0) {
        events.push({
          id: `mkt_fee_${p.id}`,
          kind: "commission",
          status: String(p.status ?? "pending"),
          amount_cents: Math.round(Number(p.platform_fee_cents ?? 0)),
          currency: String(p.currency ?? "USD"),
          direction: "debit",
          title_key: "finance.event.platform_commission",
          title_fallback: "Platform commission",
          entity_type: "seller_order",
          entity_id: entityId,
          occurred_at: String(p.created_at),
        });
      }
    }
  }

  if (entityType === "business_account") {
    const { data: entries } = await supabaseAdmin
      .from("taxi_business_wallet_entries")
      .select(
        "id,direction,amount_cents,currency,entry_type,stripe_payment_intent_id,stripe_transfer_id,description,created_at"
      )
      .eq("business_account_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);

    for (const e of entries ?? []) {
      const entryType = String(e.entry_type ?? "wallet_entry");
      const kind =
        entryType === "topup"
          ? "topup"
          : entryType === "cashout"
            ? "cashout"
            : entryType === "ride_refund"
              ? "refund"
              : "wallet_entry";
      events.push({
        id: `biz_${e.id}`,
        kind,
        status: e.stripe_transfer_id || e.stripe_payment_intent_id ? "paid" : "posted",
        amount_cents: Math.round(Number(e.amount_cents ?? 0)),
        currency: String(e.currency ?? "USD"),
        direction: e.direction === "debit" ? "debit" : "credit",
        title_key: `finance.event.${entryType}`,
        title_fallback: entryType,
        subtitle: e.description ? String(e.description) : null,
        entity_type: "business_account",
        entity_id: entityId,
        occurred_at: String(e.created_at),
        references: {
          payment_intent_id: e.stripe_payment_intent_id
            ? String(e.stripe_payment_intent_id)
            : null,
          transfer_id: e.stripe_transfer_id
            ? String(e.stripe_transfer_id)
            : null,
          wallet_entry_id: String(e.id),
        },
      });
    }
  }

  const filtered = filterFinancialEventsForRole(events, params.role);
  return sortFinancialEventsDesc(filtered).slice(0, limit);
}
