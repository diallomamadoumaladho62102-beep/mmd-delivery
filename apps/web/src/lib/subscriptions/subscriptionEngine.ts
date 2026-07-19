import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionPartnerType = "restaurant" | "seller" | "driver" | "business";

export type SubscriptionStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled"
  | "expired"
  | "suspended";

export type SubscriptionPlan = {
  id: string;
  partner_type: SubscriptionPartnerType;
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

export type PlanFeature = {
  feature_key: string;
  enabled: boolean;
  value_boolean: boolean | null;
  value_integer: number | null;
  value_numeric: number | null;
  value_text: string | null;
  value_json: unknown;
  label?: string;
};

export type PartnerSubscription = {
  id: string;
  partner_type: SubscriptionPartnerType;
  partner_user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
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

/** Config-driven feature check — never hardcode product feature names in callers. */
export async function hasSubscriptionFeature(
  supabaseAdmin: SupabaseClient,
  params: {
    partnerType: SubscriptionPartnerType;
    partnerUserId: string;
    featureKey: string;
  }
): Promise<{ entitled: boolean; value?: unknown; reason?: string }> {
  const { data, error } = await supabaseAdmin.rpc("mmd_subscription_has_feature", {
    p_partner_type: params.partnerType,
    p_partner_user_id: params.partnerUserId,
    p_feature_key: params.featureKey,
  });
  if (error) return { entitled: false, reason: error.message };
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.entitled !== true) {
    return { entitled: false, reason: String(row.reason ?? "not_entitled") };
  }
  const value =
    row.value_json ??
    row.value_numeric ??
    row.value_integer ??
    row.value_boolean ??
    row.value_text ??
    true;
  return { entitled: true, value };
}

export async function listActivePlans(
  supabaseAdmin: SupabaseClient,
  partnerType: SubscriptionPartnerType,
  opts?: { countryCode?: string | null; includeHidden?: boolean }
): Promise<SubscriptionPlan[]> {
  let query = supabaseAdmin
    .from("subscription_plans")
    .select(
      "id, partner_type, code, name, description, price_cents, currency, billing_period, trial_enabled, trial_days, status, color, sort_order, visible, stripe_price_id, stripe_product_id"
    )
    .eq("partner_type", partnerType)
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (!opts?.includeHidden) query = query.eq("visible", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const country = opts?.countryCode?.trim().toUpperCase() || null;
  const rows = (data ?? []) as SubscriptionPlan[];
  if (!country) return rows.filter((p) => !(p as unknown as { country_code?: string }).country_code);
  return rows;
}

export async function loadPlanFeatures(
  supabaseAdmin: SupabaseClient,
  planId: string
): Promise<PlanFeature[]> {
  const { data, error } = await supabaseAdmin
    .from("subscription_plan_features")
    .select(
      "feature_key, enabled, value_boolean, value_integer, value_numeric, value_text, value_json, subscription_features(label)"
    )
    .eq("plan_id", planId)
    .eq("enabled", true);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const feat = r.subscription_features as { label?: string } | null;
    return {
      feature_key: String(r.feature_key),
      enabled: Boolean(r.enabled),
      value_boolean: r.value_boolean == null ? null : Boolean(r.value_boolean),
      value_integer: r.value_integer == null ? null : Number(r.value_integer),
      value_numeric: r.value_numeric == null ? null : Number(r.value_numeric),
      value_text: r.value_text == null ? null : String(r.value_text),
      value_json: r.value_json ?? null,
      label: feat?.label,
    };
  });
}

export async function getActiveSubscription(
  supabaseAdmin: SupabaseClient,
  partnerType: SubscriptionPartnerType,
  partnerUserId: string
): Promise<(PartnerSubscription & { plan?: SubscriptionPlan | null; features?: PlanFeature[] }) | null> {
  const { data, error } = await supabaseAdmin
    .from("partner_subscriptions")
    .select("*")
    .eq("partner_type", partnerType)
    .eq("partner_user_id", partnerUserId)
    .in("status", ["active", "trialing", "past_due", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const sub = data as PartnerSubscription;
  const { data: plan } = await supabaseAdmin
    .from("subscription_plans")
    .select(
      "id, partner_type, code, name, description, price_cents, currency, billing_period, trial_enabled, trial_days, status, color, sort_order, visible, stripe_price_id, stripe_product_id"
    )
    .eq("id", sub.plan_id)
    .maybeSingle();

  const features = await loadPlanFeatures(supabaseAdmin, sub.plan_id);
  return { ...sub, plan: (plan as SubscriptionPlan) ?? null, features };
}

export async function activateSubscription(
  supabaseAdmin: SupabaseClient,
  params: {
    partnerType: SubscriptionPartnerType;
    partnerUserId: string;
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
  const { data, error } = await supabaseAdmin.rpc("mmd_subscription_activate", {
    p_partner_type: params.partnerType,
    p_partner_user_id: params.partnerUserId,
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
  return (data ?? {}) as Record<string, unknown>;
}

export async function cancelSubscription(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  opts?: { atPeriodEnd?: boolean; reason?: string | null }
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_subscription_cancel", {
    p_subscription_id: subscriptionId,
    p_at_period_end: opts?.atPeriodEnd !== false,
    p_reason: opts?.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function resumeSubscription(supabaseAdmin: SupabaseClient, subscriptionId: string) {
  const { data, error } = await supabaseAdmin.rpc("mmd_subscription_resume", {
    p_subscription_id: subscriptionId,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function changeSubscriptionPlan(
  supabaseAdmin: SupabaseClient,
  subscriptionId: string,
  newPlanId: string,
  reason?: string | null
) {
  const { data, error } = await supabaseAdmin.rpc("mmd_subscription_change_plan", {
    p_subscription_id: subscriptionId,
    p_new_plan_id: newPlanId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

export async function buildSubscriptionPortalSummary(
  supabaseAdmin: SupabaseClient,
  partnerType: SubscriptionPartnerType,
  partnerUserId: string
) {
  const [current, plans, benefits, invoices] = await Promise.all([
    getActiveSubscription(supabaseAdmin, partnerType, partnerUserId),
    listActivePlans(supabaseAdmin, partnerType),
    supabaseAdmin
      .from("subscription_active_benefits")
      .select("id, benefit_type, benefit_value, status, starts_at, expires_at")
      .eq("partner_type", partnerType)
      .eq("partner_user_id", partnerUserId)
      .in("status", ["active", "scheduled"])
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("subscription_invoices")
      .select(
        "id, kind, status, amount_cents, tax_cents, currency, description, paid_at, created_at, stripe_invoice_id"
      )
      .eq("partner_type", partnerType)
      .eq("partner_user_id", partnerUserId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const plansWithFeatures = await Promise.all(
    plans.map(async (p) => ({
      ...p,
      features: await loadPlanFeatures(supabaseAdmin, p.id),
    }))
  );

  return {
    current,
    plans: plansWithFeatures,
    benefits: benefits.data ?? [],
    invoices: invoices.data ?? [],
  };
}
