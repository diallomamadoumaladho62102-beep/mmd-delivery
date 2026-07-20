import type { SupabaseClient } from "@supabase/supabase-js";
import {
  nextTier,
  parseLoyaltySettings,
  resolveTier,
  type LoyaltyTierConfig,
} from "@/lib/loyalty/loyaltyProgram";

/** Shared server helpers for the client/driver loyalty endpoints. */

/**
 * Loyalty accounts are separated by role. Points never move between roles.
 * Phase 1 exposes the client/driver roles through the user-facing endpoints;
 * 'restaurant'/'seller' accounts exist in the schema but their programs are
 * added in a later phase.
 */
export type LoyaltyRole = "client" | "driver";

export function normalizeLoyaltyRole(value: unknown): LoyaltyRole {
  return value === "driver" ? "driver" : "client";
}

export type LoyaltySummary = {
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  /** Next tier on the lifetime ladder, or null if already at top. */
  next_tier: { code: string; label: string; min_lifetime_points: number } | null;
  /** Lifetime points still needed to reach next_tier (0 if maxed). */
  points_to_next_tier: number;
  /** 0–100 progress toward next_tier based on lifetime points. */
  tier_progress_pct: number;
  credit_cents: number;
  available_credit_cents: number;
  next_credit_expiry: string | null;
  currency: string;
  referral_code: string | null;
  settings: {
    enabled: boolean;
    conversion_points: number;
    conversion_credit_cents: number;
    credit_validity_months: number;
  };
};

export async function loadLoyaltyTiers(
  supabaseAdmin: SupabaseClient
): Promise<LoyaltyTierConfig[]> {
  const { data } = await supabaseAdmin
    .from("loyalty_tiers")
    .select("code, label, min_lifetime_points, active")
    .eq("active", true)
    .order("min_lifetime_points", { ascending: true });

  const rows = (data ?? []) as Array<{
    code: string;
    label: string;
    min_lifetime_points: number;
  }>;

  if (rows.length === 0) return [];
  return rows.map((r) => ({
    code: r.code,
    label: r.label,
    minLifetimePoints: Number(r.min_lifetime_points) || 0,
  }));
}

export async function buildLoyaltySummary(
  supabaseAdmin: SupabaseClient,
  userId: string,
  role: LoyaltyRole = "client"
): Promise<LoyaltySummary> {
  const [
    { data: account },
    { data: wallet },
    { data: settingsRow },
    { data: codeRow },
    { data: nextLot },
    { data: availableCents },
    tiers,
  ] = await Promise.all([
    supabaseAdmin
      .from("loyalty_accounts")
      .select("points_balance, lifetime_points, tier_code")
      .eq("user_id", userId)
      .eq("role", role)
      .maybeSingle(),
    // MMD Credit is a single spendable wallet per user (client/driver); it is
    // not role-scoped, so both role views surface the same credit balance.
    supabaseAdmin
      .from("mmd_credit_wallets")
      .select("balance_cents, currency")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin.from("loyalty_settings").select("*").eq("singleton", true).maybeSingle(),
    supabaseAdmin
      .from("loyalty_referral_codes")
      .select("code")
      .eq("user_id", userId)
      .eq("role", role)
      .maybeSingle(),
    supabaseAdmin
      .from("mmd_credit_lots")
      .select("expires_at")
      .eq("user_id", userId)
      .gt("remaining_cents", 0)
      .not("expires_at", "is", null)
      .order("expires_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.rpc("mmd_credit_available_cents", { p_user_id: userId }),
    loadLoyaltyTiers(supabaseAdmin),
  ]);

  const settings = parseLoyaltySettings(settingsRow as Record<string, unknown> | null);
  const lifetime = Number(account?.lifetime_points ?? 0);
  const tierList = tiers.length > 0 ? tiers : undefined;
  const tier = resolveTier(lifetime, tierList);
  const upcoming = nextTier(lifetime, tierList);
  const currentFloor = tier.minLifetimePoints;
  const nextFloor = upcoming?.minLifetimePoints ?? currentFloor;
  const span = Math.max(1, nextFloor - currentFloor);
  const progressed = Math.min(span, Math.max(0, lifetime - currentFloor));
  const tierProgressPct = upcoming
    ? Math.max(0, Math.min(100, Math.round((progressed / span) * 100)))
    : 100;

  return {
    points_balance: Number(account?.points_balance ?? 0),
    lifetime_points: lifetime,
    tier_code: (account?.tier_code as string) || tier.code,
    tier_label: tier.label,
    next_tier: upcoming
      ? {
          code: upcoming.code,
          label: upcoming.label,
          min_lifetime_points: upcoming.minLifetimePoints,
        }
      : null,
    points_to_next_tier: upcoming
      ? Math.max(0, upcoming.minLifetimePoints - lifetime)
      : 0,
    tier_progress_pct: tierProgressPct,
    credit_cents: Number(wallet?.balance_cents ?? 0),
    available_credit_cents:
      availableCents != null && Number.isFinite(Number(availableCents))
        ? Number(availableCents)
        : Number(wallet?.balance_cents ?? 0),
    next_credit_expiry: (nextLot?.expires_at as string | null) ?? null,
    currency: (wallet?.currency as string) || settings.currency,
    referral_code: (codeRow?.code as string) ?? null,
    settings: {
      enabled: settings.enabled,
      conversion_points: settings.conversionPoints,
      conversion_credit_cents: settings.conversionCreditCents,
      credit_validity_months: settings.creditValidityMonths,
    },
  };
}

/** Ensure the authenticated user has a referral code, creating one if missing. */
export async function ensureReferralCode(
  supabaseAdmin: SupabaseClient,
  userId: string,
  role: LoyaltyRole = "client"
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("mmd_loyalty_get_or_create_code", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) {
    console.error("[loyalty] ensureReferralCode failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}
