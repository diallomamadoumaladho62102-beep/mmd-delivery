import type { SupabaseClient } from "@supabase/supabase-js";
import { parseLoyaltySettings, resolveTier, type LoyaltyTierConfig } from "@/lib/loyalty/loyaltyProgram";

/** Shared server helpers for the client/driver loyalty endpoints. */

export type LoyaltySummary = {
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  credit_cents: number;
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
  userId: string
): Promise<LoyaltySummary> {
  const [{ data: account }, { data: wallet }, { data: settingsRow }, { data: codeRow }, tiers] =
    await Promise.all([
      supabaseAdmin
        .from("loyalty_accounts")
        .select("points_balance, lifetime_points, tier_code")
        .eq("user_id", userId)
        .maybeSingle(),
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
        .maybeSingle(),
      loadLoyaltyTiers(supabaseAdmin),
    ]);

  const settings = parseLoyaltySettings(settingsRow as Record<string, unknown> | null);
  const lifetime = Number(account?.lifetime_points ?? 0);
  const tierList = tiers.length > 0 ? tiers : undefined;
  const tier = resolveTier(lifetime, tierList);

  return {
    points_balance: Number(account?.points_balance ?? 0),
    lifetime_points: lifetime,
    tier_code: (account?.tier_code as string) || tier.code,
    tier_label: tier.label,
    credit_cents: Number(wallet?.balance_cents ?? 0),
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
  userId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("mmd_loyalty_get_or_create_code", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[loyalty] ensureReferralCode failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}
