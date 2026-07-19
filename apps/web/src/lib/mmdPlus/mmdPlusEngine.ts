import type { SupabaseClient } from "@supabase/supabase-js";

export type MmdPlusStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled"
  | "expired"
  | "suspended";

export type MmdPlusService = "food" | "delivery" | "taxi" | "marketplace";

export type MmdPlusPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_period: "monthly" | "yearly";
  trial_enabled: boolean;
  trial_days: number;
  status: string;
  color: string | null;
  sort_order: number;
  visible: boolean;
  stripe_price_id: string | null;
  stripe_product_id: string | null;
};

export type MmdPlusSubscription = {
  id: string;
  user_id: string;
  plan_id: string;
  status: MmdPlusStatus;
  starts_at: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  renews: boolean;
  is_trial: boolean;
  price_cents: number;
  currency: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
};

export type MmdPlusCheckoutBenefits = {
  ok: boolean;
  active: boolean;
  subscription_id?: string;
  plan_id?: string;
  delivery_fee_discount_cents: number;
  order_discount_cents: number;
  cashback_pct: number;
  loyalty_points_bonus_pct: number;
  flags: Record<string, boolean>;
  applied: unknown[];
  error?: string;
};

type CacheEntry = { expiresAt: number; payload: MmdPlusCheckoutBenefits };

const entitlementsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 45_000;

function cacheKey(
  userId: string,
  service: MmdPlusService,
  subtotalCents: number,
  deliveryFeeCents: number
) {
  // Bucket amounts to reduce cache fragmentation while staying safe for checkout.
  const subBucket = Math.floor(subtotalCents / 100) * 100;
  const feeBucket = Math.floor(deliveryFeeCents / 50) * 50;
  return `${userId}:${service}:${subBucket}:${feeBucket}`;
}

export function invalidateMmdPlusCache(userId?: string) {
  if (!userId) {
    entitlementsCache.clear();
    return;
  }
  for (const key of entitlementsCache.keys()) {
    if (key.startsWith(`${userId}:`)) entitlementsCache.delete(key);
  }
}

/** Config-driven checkout benefits — fail-open, cached, never throws. */
export async function resolveMmdPlusCheckoutBenefits(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    service: MmdPlusService;
    subtotalCents?: number;
    deliveryFeeCents?: number;
    skipCache?: boolean;
  }
): Promise<MmdPlusCheckoutBenefits> {
  const empty: MmdPlusCheckoutBenefits = {
    ok: true,
    active: false,
    delivery_fee_discount_cents: 0,
    order_discount_cents: 0,
    cashback_pct: 0,
    loyalty_points_bonus_pct: 0,
    flags: {},
    applied: [],
  };

  const userId = String(params.userId ?? "").trim();
  if (!userId) return empty;

  const subtotalCents = Math.max(0, Math.round(Number(params.subtotalCents ?? 0)));
  const deliveryFeeCents = Math.max(0, Math.round(Number(params.deliveryFeeCents ?? 0)));
  const key = cacheKey(userId, params.service, subtotalCents, deliveryFeeCents);

  if (!params.skipCache) {
    const hit = entitlementsCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.payload;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("mmd_plus_resolve_checkout_benefits", {
      p_user_id: userId,
      p_service: params.service,
      p_subtotal_cents: subtotalCents,
      p_delivery_fee_cents: deliveryFeeCents,
    });
    if (error) {
      console.warn("[mmd-plus] resolve failed (fail-open)", error.message);
      return empty;
    }
    const row = (data ?? {}) as Record<string, unknown>;
    const payload: MmdPlusCheckoutBenefits = {
      ok: row.ok !== false,
      active: row.active === true,
      subscription_id: row.subscription_id ? String(row.subscription_id) : undefined,
      plan_id: row.plan_id ? String(row.plan_id) : undefined,
      delivery_fee_discount_cents: Math.max(0, Number(row.delivery_fee_discount_cents ?? 0)),
      order_discount_cents: Math.max(0, Number(row.order_discount_cents ?? 0)),
      cashback_pct: Math.max(0, Number(row.cashback_pct ?? 0)),
      loyalty_points_bonus_pct: Math.max(0, Number(row.loyalty_points_bonus_pct ?? 0)),
      flags: (row.flags as Record<string, boolean>) ?? {},
      applied: Array.isArray(row.applied) ? row.applied : [],
    };
    entitlementsCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return payload;
  } catch (e) {
    console.warn("[mmd-plus] resolve threw (fail-open)", e instanceof Error ? e.message : e);
    return empty;
  }
}

export async function recordMmdPlusBenefitApplication(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    subscriptionId?: string | null;
    service: MmdPlusService;
    entityType: string;
    entityId: string;
    benefits: MmdPlusCheckoutBenefits;
    currency?: string;
    idempotencyKey?: string;
  }
): Promise<void> {
  if (!params.benefits.active) return;
  try {
    await supabaseAdmin.from("mmd_plus_benefit_applications").insert({
      user_id: params.userId,
      subscription_id: params.subscriptionId ?? params.benefits.subscription_id ?? null,
      service: params.service,
      entity_type: params.entityType,
      entity_id: params.entityId,
      adjustments: {
        applied: params.benefits.applied,
        flags: params.benefits.flags,
        cashback_pct: params.benefits.cashback_pct,
        loyalty_points_bonus_pct: params.benefits.loyalty_points_bonus_pct,
      },
      delivery_fee_discount_cents: params.benefits.delivery_fee_discount_cents,
      order_discount_cents: params.benefits.order_discount_cents,
      currency: (params.currency ?? "USD").toUpperCase(),
      idempotency_key: params.idempotencyKey ?? `${params.entityType}:${params.entityId}:mmd_plus`,
    });
  } catch (e) {
    console.warn("[mmd-plus] application record failed", e instanceof Error ? e.message : e);
  }
}

export async function listActiveMmdPlusPlans(
  supabaseAdmin: SupabaseClient,
  opts?: { countryCode?: string | null; includeHidden?: boolean }
): Promise<MmdPlusPlan[]> {
  let query = supabaseAdmin
    .from("mmd_plus_plans")
    .select(
      "id, code, name, description, price_cents, currency, billing_period, trial_enabled, trial_days, status, color, sort_order, visible, stripe_price_id, stripe_product_id"
    )
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (!opts?.includeHidden) query = query.eq("visible", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MmdPlusPlan[];
}

export async function loadMmdPlusPlanFeatures(
  supabaseAdmin: SupabaseClient,
  planId: string
) {
  const { data, error } = await supabaseAdmin
    .from("mmd_plus_plan_features")
    .select(
      "feature_key, enabled, value_boolean, value_integer, value_numeric, value_text, value_json, mmd_plus_features(label, description, apply_as)"
    )
    .eq("plan_id", planId)
    .eq("enabled", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const feat = row.mmd_plus_features as
      | { label?: string; description?: string; apply_as?: string }
      | null;
    return {
      feature_key: String(row.feature_key),
      enabled: Boolean(row.enabled),
      value_boolean: row.value_boolean as boolean | null,
      value_integer: row.value_integer as number | null,
      value_numeric: row.value_numeric as number | null,
      value_text: row.value_text as string | null,
      value_json: row.value_json,
      label: feat?.label,
      description: feat?.description,
      apply_as: feat?.apply_as,
    };
  });
}

export async function getActiveMmdPlusSubscription(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<MmdPlusSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("mmd_plus_subscriptions")
    .select(
      "id, user_id, plan_id, status, starts_at, current_period_end, trial_ends_at, cancel_at_period_end, renews, is_trial, price_cents, currency, stripe_subscription_id, stripe_customer_id"
    )
    .eq("user_id", userId)
    .in("status", ["active", "trialing", "past_due", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MmdPlusSubscription | null) ?? null;
}

export async function activateMmdPlus(
  supabaseAdmin: SupabaseClient,
  params: {
    userId: string;
    planId: string;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
    isTrial?: boolean;
    trialDays?: number | null;
    offeredByAdmin?: boolean;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_activate", {
    p_user_id: params.userId,
    p_plan_id: params.planId,
    p_stripe_subscription_id: params.stripeSubscriptionId ?? null,
    p_stripe_customer_id: params.stripeCustomerId ?? null,
    p_is_trial: params.isTrial ?? false,
    p_trial_days: params.trialDays ?? null,
    p_offered_by_admin: params.offeredByAdmin ?? false,
    p_idempotency_key: params.idempotencyKey ?? null,
    p_metadata: params.metadata ?? {},
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache(params.userId);
  return (data ?? {}) as Record<string, unknown>;
}

export async function cancelMmdPlus(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  opts?: { atPeriodEnd?: boolean; reason?: string | null }
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_cancel", {
    p_subscription_id: subscriptionId,
    p_at_period_end: opts?.atPeriodEnd !== false,
    p_reason: opts?.reason ?? null,
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache();
  return (data ?? {}) as Record<string, unknown>;
}

export async function resumeMmdPlus(supabaseAdmin: SupabaseClient, subscriptionId: string) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_resume", {
    p_subscription_id: subscriptionId,
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache();
  return (data ?? {}) as Record<string, unknown>;
}

export async function changeMmdPlusPlan(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  planId: string,
  reason?: string | null
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_change_plan", {
    p_subscription_id: subscriptionId,
    p_new_plan_id: planId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache();
  return (data ?? {}) as Record<string, unknown>;
}

export async function extendMmdPlus(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  days: number,
  reason?: string | null
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_extend", {
    p_subscription_id: subscriptionId,
    p_days: days,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache();
  return (data ?? {}) as Record<string, unknown>;
}

export async function suspendMmdPlus(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  reason?: string | null
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_plus_suspend", {
    p_subscription_id: subscriptionId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  invalidateMmdPlusCache();
  return (data ?? {}) as Record<string, unknown>;
}
