import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 4 — central commission engine client helpers.
 *
 * All authoritative resolution / snapshotting runs in SECURITY DEFINER RPCs.
 * These helpers only dispatch and normalize results for Food + Marketplace.
 */

export type CommissionPartnerType = "restaurant" | "seller";
export type CommissionService = "food" | "marketplace";
export type CommissionOrderKind = "food" | "marketplace";

export type CommissionRuleType =
  | "loyalty_benefit"
  | "partner_override"
  | "commercial_contract"
  | "commercial_campaign"
  | "service_rate"
  | "category_rate"
  | "city_rate"
  | "country_rate"
  | "standard_rate";

export type ResolvedCommission = {
  ok: boolean;
  rate_pct: number;
  fixed_fee_cents: number;
  fee_credit_cents: number;
  base_rate_pct: number | null;
  rule_type: CommissionRuleType;
  rule_id: string | null;
  rule_label: string | null;
  loyalty_benefit_id: string | null;
  currency?: string;
  already_snapshotted?: boolean;
  snapshot_id?: string;
  error?: string;
};

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeResolved(raw: Record<string, unknown> | null): ResolvedCommission {
  if (!raw || raw.ok === false) {
    return {
      ok: false,
      rate_pct: 0,
      fixed_fee_cents: 0,
      fee_credit_cents: 0,
      base_rate_pct: null,
      rule_type: "standard_rate",
      rule_id: null,
      rule_label: null,
      loyalty_benefit_id: null,
      error: String(raw?.error ?? "resolve_failed"),
    };
  }

  return {
    ok: true,
    rate_pct: asNumber(raw.rate_pct),
    fixed_fee_cents: Math.max(0, Math.round(asNumber(raw.fixed_fee_cents))),
    fee_credit_cents: Math.max(0, Math.round(asNumber(raw.fee_credit_cents))),
    base_rate_pct: raw.base_rate_pct == null ? null : asNumber(raw.base_rate_pct),
    rule_type: String(raw.rule_type ?? "standard_rate") as CommissionRuleType,
    rule_id: raw.rule_id ? String(raw.rule_id) : null,
    rule_label: raw.rule_label ? String(raw.rule_label) : null,
    loyalty_benefit_id: raw.loyalty_benefit_id ? String(raw.loyalty_benefit_id) : null,
    currency: raw.currency ? String(raw.currency) : undefined,
    already_snapshotted: Boolean(raw.already_snapshotted),
    snapshot_id: raw.snapshot_id ? String(raw.snapshot_id) : undefined,
  };
}

export async function resolveCommission(
  supabaseAdmin: SupabaseClient,
  params: {
    partnerType: CommissionPartnerType;
    partnerUserId: string;
    service: CommissionService;
    countryCode?: string | null;
    city?: string | null;
    category?: string | null;
  }
): Promise<ResolvedCommission> {
  const { data, error } = await supabaseAdmin.rpc("mmd_resolve_commission", {
    p_partner_type: params.partnerType,
    p_partner_user_id: params.partnerUserId,
    p_service: params.service,
    p_country_code: params.countryCode ?? null,
    p_city: params.city ?? null,
    p_category: params.category ?? null,
  });

  if (error) {
    return {
      ok: false,
      rate_pct: 0,
      fixed_fee_cents: 0,
      fee_credit_cents: 0,
      base_rate_pct: null,
      rule_type: "standard_rate",
      rule_id: null,
      rule_label: null,
      loyalty_benefit_id: null,
      error: error.message,
    };
  }

  return normalizeResolved((data ?? null) as Record<string, unknown> | null);
}

/**
 * Write-once commission snapshot for an order. Safe to call repeatedly —
 * subsequent calls return the existing frozen snapshot without recalculation.
 */
export async function snapshotOrderCommission(
  supabaseAdmin: SupabaseClient,
  params: {
    orderKind: CommissionOrderKind;
    orderId: string;
    partnerType: CommissionPartnerType;
    partnerUserId: string;
    service: CommissionService;
    currency?: string | null;
    countryCode?: string | null;
    city?: string | null;
    category?: string | null;
  }
): Promise<ResolvedCommission> {
  const orderId = String(params.orderId ?? "").trim();
  const partnerUserId = String(params.partnerUserId ?? "").trim();
  if (!orderId || !partnerUserId) {
    return {
      ok: false,
      rate_pct: 0,
      fixed_fee_cents: 0,
      fee_credit_cents: 0,
      base_rate_pct: null,
      rule_type: "standard_rate",
      rule_id: null,
      rule_label: null,
      loyalty_benefit_id: null,
      error: "invalid_input",
    };
  }

  const { data, error } = await supabaseAdmin.rpc("mmd_snapshot_commission", {
    p_order_kind: params.orderKind,
    p_order_id: orderId,
    p_partner_type: params.partnerType,
    p_partner_user_id: partnerUserId,
    p_service: params.service,
    p_currency: params.currency ?? "USD",
    p_country_code: params.countryCode ?? null,
    p_city: params.city ?? null,
    p_category: params.category ?? null,
  });

  if (error) {
    console.error("[commission-engine] snapshot failed", {
      order_kind: params.orderKind,
      order_id: orderId,
      message: error.message,
    });
    return {
      ok: false,
      rate_pct: 0,
      fixed_fee_cents: 0,
      fee_credit_cents: 0,
      base_rate_pct: null,
      rule_type: "standard_rate",
      rule_id: null,
      rule_label: null,
      loyalty_benefit_id: null,
      error: error.message,
    };
  }

  return normalizeResolved((data ?? null) as Record<string, unknown> | null);
}

export async function loadCommissionSnapshot(
  supabaseAdmin: SupabaseClient,
  orderKind: CommissionOrderKind,
  orderId: string
): Promise<ResolvedCommission | null> {
  const { data, error } = await supabaseAdmin
    .from("commission_snapshots")
    .select(
      "id, rate_pct, fixed_fee_cents, fee_credit_cents, base_rate_pct, rule_type, rule_id, rule_label, loyalty_benefit_id, currency"
    )
    .eq("order_kind", orderKind)
    .eq("order_id", orderId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    ok: true,
    rate_pct: asNumber(data.rate_pct),
    fixed_fee_cents: Math.max(0, Math.round(asNumber(data.fixed_fee_cents))),
    fee_credit_cents: Math.max(0, Math.round(asNumber(data.fee_credit_cents))),
    base_rate_pct: data.base_rate_pct == null ? null : asNumber(data.base_rate_pct),
    rule_type: String(data.rule_type) as CommissionRuleType,
    rule_id: data.rule_id ? String(data.rule_id) : null,
    rule_label: data.rule_label ? String(data.rule_label) : null,
    loyalty_benefit_id: data.loyalty_benefit_id ? String(data.loyalty_benefit_id) : null,
    currency: data.currency ? String(data.currency) : undefined,
    already_snapshotted: true,
    snapshot_id: String(data.id),
  };
}

/** Platform fee in cents from a resolved rate + optional fixed fee − fee credit. */
export function computePlatformFeeCents(
  subtotalCents: number,
  resolved: Pick<ResolvedCommission, "rate_pct" | "fixed_fee_cents" | "fee_credit_cents">
): number {
  const gross = Math.max(0, Math.round(subtotalCents));
  const fromRate = Math.round((gross * resolved.rate_pct) / 100);
  const withFixed = fromRate + Math.max(0, resolved.fixed_fee_cents);
  return Math.max(0, withFixed - Math.max(0, resolved.fee_credit_cents));
}
