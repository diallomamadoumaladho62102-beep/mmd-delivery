import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared server helpers for the marketplace seller loyalty portal endpoints. */

const REFERRAL_BASE_URL = "https://www.mmddelivery.com/vendeur/r";

export type SellerTier = {
  code: string;
  label: string;
  min_points: number;
  min_completed_sales: number;
  min_revenue_cents: number;
  sort_order: number;
};

export type SellerLoyaltySummary = {
  enabled: boolean;
  account_status: "active" | "suspended";
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  next_tier: SellerTier | null;
  completed_sales: number;
  revenue_cents: number;
  currency: string;
  active_benefits_count: number;
  referral_code: string | null;
  referral_link: string | null;
};

export async function loadSellerTiers(admin: SupabaseClient): Promise<SellerTier[]> {
  const { data } = await admin
    .from("marketplace_loyalty_tiers")
    .select("code, label, min_points, min_completed_sales, min_revenue_cents, sort_order")
    .eq("active", true)
    .is("country_code", null)
    .order("sort_order", { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    code: String(r.code),
    label: String(r.label),
    min_points: Number(r.min_points) || 0,
    min_completed_sales: Number(r.min_completed_sales) || 0,
    min_revenue_cents: Number(r.min_revenue_cents) || 0,
    sort_order: Number(r.sort_order) || 0,
  }));
}

/** Ensure the seller has a referral code (role='seller'), returning it. */
export async function ensureSellerReferralCode(
  admin: SupabaseClient,
  sellerUserId: string
): Promise<string | null> {
  const { data, error } = await admin.rpc("mmd_loyalty_get_or_create_code", {
    p_user_id: sellerUserId,
    p_role: "seller",
  });
  if (error) {
    console.error("[marketplace-loyalty] ensure referral code failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

export async function buildSellerLoyaltySummary(
  admin: SupabaseClient,
  sellerUserId: string
): Promise<SellerLoyaltySummary> {
  const [
    { data: account },
    { data: settings },
    { data: stats },
    tiers,
    { count: benefitsCount },
    referralCode,
  ] = await Promise.all([
    admin
      .from("loyalty_accounts")
      .select("points_balance, lifetime_points, tier_code, status")
      .eq("user_id", sellerUserId)
      .eq("role", "seller")
      .maybeSingle(),
    admin.from("marketplace_loyalty_settings").select("*").eq("singleton", true).maybeSingle(),
    admin
      .from("marketplace_loyalty_stats")
      .select("completed_sales, revenue_cents")
      .eq("seller_user_id", sellerUserId)
      .maybeSingle(),
    loadSellerTiers(admin),
    admin
      .from("marketplace_active_benefits")
      .select("id", { count: "exact", head: true })
      .eq("seller_user_id", sellerUserId)
      .in("status", ["scheduled", "active"]),
    ensureSellerReferralCode(admin, sellerUserId),
  ]);

  const lifetime = Number(account?.lifetime_points ?? 0);
  const completedSales = Number(stats?.completed_sales ?? 0);
  const revenueCents = Number(stats?.revenue_cents ?? 0);
  const tierCode = (account?.tier_code as string) || "standard";
  const currentTier = tiers.find((t) => t.code === tierCode) ?? null;
  const tierLabel = currentTier?.label ?? "Standard";

  // The next tier is the first ladder step the seller does not yet meet.
  const nextTier =
    tiers.find(
      (t) =>
        t.sort_order > (currentTier?.sort_order ?? 0) &&
        (lifetime < t.min_points ||
          completedSales < t.min_completed_sales ||
          revenueCents < t.min_revenue_cents)
    ) ?? null;

  return {
    enabled: Boolean(settings?.enabled),
    account_status: (account?.status as "active" | "suspended") || "active",
    points_balance: Number(account?.points_balance ?? 0),
    lifetime_points: lifetime,
    tier_code: tierCode,
    tier_label: tierLabel,
    next_tier: nextTier,
    completed_sales: completedSales,
    revenue_cents: revenueCents,
    currency: (settings?.currency as string) || "USD",
    active_benefits_count: Number(benefitsCount ?? 0),
    referral_code: referralCode,
    referral_link: referralCode ? `${REFERRAL_BASE_URL}/${referralCode}` : null,
  };
}
