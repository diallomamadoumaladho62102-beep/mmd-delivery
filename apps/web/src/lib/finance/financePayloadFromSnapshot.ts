import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_FINANCE_SNAPSHOT_SELECT } from "@/lib/orderPaymentSelect";
import { DELIVERY_REQUEST_FINANCE_SNAPSHOT_SELECT } from "@/lib/deliveryRequestPaymentSelect";
import {
  resolveDeliveryRequestPlatformCountry,
  resolveOrderPlatformCountry,
} from "@/lib/platformCountryResolver";

export type FinanceSnapshotPayload = {
  amount_cents: number;
  gross_cents: number;
  tax_cents: number;
  service_fee_cents: number;
  delivery_fee_cents: number;
  commission_cents: number;
  partner_cents: number;
  driver_cents: number;
  restaurant_cents: number;
  seller_cents: number;
  promotion_mmd_cents: number;
  promotion_partner_cents: number;
  mmd_credit_cents: number;
  cashback_cents: number;
  tip_cents: number;
  wait_fee_cents: number;
  cancel_fee_cents: number;
  provider_fee_cents: number;
  currency: string;
  country_code: string | null;
  city: string | null;
  partner_user_id: string | null;
  legal_entity: string;
  source: string;
  correlation_id: string | null;
  description: string;
  snapshot: Record<string, unknown>;
};

function n(value: unknown): number {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

function majorToCents(value: unknown): number {
  const x = Number(value ?? 0);
  if (!Number.isFinite(x)) return 0;
  // Heuristic: values >= 1000 likely already cents on some rows; prefer *_cents columns.
  return Math.round(x * 100);
}

/**
 * Build finance enqueue payload from persisted entity snapshots only.
 * Never recalculates using current pricing rules.
 */
export async function buildFinancePayloadFromSnapshot(params: {
  supabaseAdmin: SupabaseClient;
  vertical: "food" | "delivery" | "taxi" | "marketplace";
  entityId: string;
  fallbackAmountCents?: number;
  paymentIntentId?: string | null;
}): Promise<FinanceSnapshotPayload> {
  const { supabaseAdmin, vertical, entityId } = params;
  const base: FinanceSnapshotPayload = {
    amount_cents: params.fallbackAmountCents ?? 0,
    gross_cents: params.fallbackAmountCents ?? 0,
    tax_cents: 0,
    service_fee_cents: 0,
    delivery_fee_cents: 0,
    commission_cents: 0,
    partner_cents: 0,
    driver_cents: 0,
    restaurant_cents: 0,
    seller_cents: 0,
    promotion_mmd_cents: 0,
    promotion_partner_cents: 0,
    mmd_credit_cents: 0,
    cashback_cents: 0,
    tip_cents: 0,
    wait_fee_cents: 0,
    cancel_fee_cents: 0,
    provider_fee_cents: 0,
    currency: "USD",
    country_code: null,
    city: null,
    partner_user_id: null,
    legal_entity: "MMD_US",
    source: vertical,
    correlation_id: params.paymentIntentId ?? entityId,
    description: `${vertical} payment ${entityId}`,
    snapshot: {},
  };

  try {
    if (vertical === "food") {
      const { data } = await supabaseAdmin
        .from("orders")
        .select(ORDER_FINANCE_SNAPSHOT_SELECT)
        .eq("id", entityId)
        .maybeSingle();
      if (!data) return base;
      const row = data as Record<string, unknown>;
      const amount =
        n(row.total_cents) ||
        majorToCents(row.total) ||
        params.fallbackAmountCents ||
        0;
      return {
        ...base,
        amount_cents: amount,
        gross_cents: amount,
        tax_cents: n(row.tax_cents) || n(row.taxes_cents) || majorToCents(row.tax),
        service_fee_cents: n(row.service_fee_cents),
        delivery_fee_cents: n(row.delivery_fee_cents),
        commission_cents: n(row.commission_cents) || n(row.platform_fee_cents),
        partner_cents: Math.max(
          0,
          n(row.subtotal_cents) || majorToCents(row.items_subtotal)
        ),
        restaurant_cents: Math.max(
          0,
          n(row.subtotal_cents) || majorToCents(row.items_subtotal)
        ),
        driver_cents: majorToCents(row.delivery_pay),
        promotion_mmd_cents: majorToCents(row.promo_discount_amount) || majorToCents(row.discounts),
        mmd_credit_cents: n(row.mmd_credit_applied_cents),
        currency: String(row.currency ?? "USD").toUpperCase(),
        country_code: resolveOrderPlatformCountry(row),
        partner_user_id: row.restaurant_user_id
          ? String(row.restaurant_user_id)
          : null,
        snapshot: row,
      };
    }

    if (vertical === "delivery") {
      const { data } = await supabaseAdmin
        .from("delivery_requests")
        .select(DELIVERY_REQUEST_FINANCE_SNAPSHOT_SELECT)
        .eq("id", entityId)
        .maybeSingle();
      if (!data) return base;
      const row = data as Record<string, unknown>;
      const amount =
        n(row.total_cents) ||
        majorToCents(row.total) ||
        params.fallbackAmountCents ||
        0;
      return {
        ...base,
        amount_cents: amount,
        gross_cents: amount,
        tax_cents: n(row.tax_cents) || majorToCents(row.tax),
        service_fee_cents: n(row.service_fee_cents),
        delivery_fee_cents:
          n(row.delivery_fee_cents) || majorToCents(row.delivery_fee),
        commission_cents: n(row.commission_cents),
        driver_cents: majorToCents(row.driver_pay),
        promotion_mmd_cents: majorToCents(row.discounts),
        mmd_credit_cents: n(row.mmd_credit_applied_cents),
        currency: String(row.currency ?? "USD").toUpperCase(),
        country_code: resolveDeliveryRequestPlatformCountry(row),
        snapshot: row,
      };
    }

    if (vertical === "taxi") {
      const { data } = await supabaseAdmin
        .from("taxi_rides")
        .select(
          "id,final_price_cents,total_cents,tax_cents,service_fee_cents,tip_cents,wait_fee_cents,cancel_fee_cents,currency,country_code,city,driver_user_id,driver_earnings_cents,platform_fee_cents,commission_cents,mmd_credit_applied_cents,promo_discount_cents"
        )
        .eq("id", entityId)
        .maybeSingle();
      if (!data) return base;
      const row = data as Record<string, unknown>;
      const amount =
        n(row.final_price_cents) ||
        n(row.total_cents) ||
        params.fallbackAmountCents ||
        0;
      return {
        ...base,
        amount_cents: amount,
        gross_cents: amount,
        tax_cents: n(row.tax_cents),
        service_fee_cents: n(row.service_fee_cents),
        tip_cents: n(row.tip_cents),
        wait_fee_cents: n(row.wait_fee_cents),
        cancel_fee_cents: n(row.cancel_fee_cents),
        commission_cents: n(row.commission_cents) || n(row.platform_fee_cents),
        driver_cents: n(row.driver_earnings_cents),
        partner_cents: n(row.driver_earnings_cents),
        promotion_mmd_cents: n(row.promo_discount_cents),
        mmd_credit_cents: n(row.mmd_credit_applied_cents),
        currency: String(row.currency ?? "USD").toUpperCase(),
        country_code: row.country_code ? String(row.country_code) : null,
        city: row.city ? String(row.city) : null,
        partner_user_id: row.driver_user_id ? String(row.driver_user_id) : null,
        snapshot: row,
      };
    }

    // marketplace
    const { data } = await supabaseAdmin
      .from("seller_orders")
      .select(
        "id,total_cents,tax_cents,delivery_fee_cents,service_fee_cents,currency,country_code,seller_id,client_user_id,commission_cents,platform_fee_cents,seller_net_cents,discount_cents,mmd_credit_applied_cents"
      )
      .eq("id", entityId)
      .maybeSingle();
    if (!data) return base;
    const row = data as Record<string, unknown>;
    const amount = n(row.total_cents) || params.fallbackAmountCents || 0;
    return {
      ...base,
      amount_cents: amount,
      gross_cents: amount,
      tax_cents: n(row.tax_cents),
      delivery_fee_cents: n(row.delivery_fee_cents),
      service_fee_cents: n(row.service_fee_cents),
      commission_cents: n(row.commission_cents) || n(row.platform_fee_cents),
      seller_cents: n(row.seller_net_cents),
      partner_cents: n(row.seller_net_cents),
      promotion_mmd_cents: n(row.discount_cents),
      mmd_credit_cents: n(row.mmd_credit_applied_cents),
      currency: String(row.currency ?? "USD").toUpperCase(),
      country_code: row.country_code ? String(row.country_code) : null,
      partner_user_id: row.seller_id ? String(row.seller_id) : null,
      snapshot: row,
    };
  } catch (e) {
    console.warn(
      "[finance] snapshot payload fail-open",
      e instanceof Error ? e.message : e
    );
    return base;
  }
}
