import type { SupabaseClient } from "@supabase/supabase-js";

/** Shared server helpers for the restaurant loyalty portal endpoints. */

const REFERRAL_BASE_URL = "https://www.mmddelivery.com/partenaire/r";

export type RestaurantTier = {
  code: string;
  label: string;
  min_points: number;
  min_completed_orders: number;
  min_revenue_cents: number;
  sort_order: number;
};

export type RestaurantLoyaltySummary = {
  enabled: boolean;
  account_status: "active" | "suspended";
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  next_tier: RestaurantTier | null;
  completed_orders: number;
  revenue_cents: number;
  currency: string;
  active_benefits_count: number;
  referral_code: string | null;
  referral_link: string | null;
};

export async function loadRestaurantTiers(admin: SupabaseClient): Promise<RestaurantTier[]> {
  const { data } = await admin
    .from("restaurant_loyalty_tiers")
    .select("code, label, min_points, min_completed_orders, min_revenue_cents, sort_order")
    .eq("active", true)
    .is("country_code", null)
    .order("sort_order", { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    code: String(r.code),
    label: String(r.label),
    min_points: Number(r.min_points) || 0,
    min_completed_orders: Number(r.min_completed_orders) || 0,
    min_revenue_cents: Number(r.min_revenue_cents) || 0,
    sort_order: Number(r.sort_order) || 0,
  }));
}

/** Ensure the restaurant has a referral code (role='restaurant'), returning it. */
export async function ensureRestaurantReferralCode(
  admin: SupabaseClient,
  restaurantUserId: string
): Promise<string | null> {
  const { data, error } = await admin.rpc("mmd_loyalty_get_or_create_code", {
    p_user_id: restaurantUserId,
    p_role: "restaurant",
  });
  if (error) {
    console.error("[restaurant-loyalty] ensure referral code failed", error.message);
    return null;
  }
  return (data as string) ?? null;
}

export async function buildRestaurantLoyaltySummary(
  admin: SupabaseClient,
  restaurantUserId: string
): Promise<RestaurantLoyaltySummary> {
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
      .eq("user_id", restaurantUserId)
      .eq("role", "restaurant")
      .maybeSingle(),
    admin.from("restaurant_loyalty_settings").select("*").eq("singleton", true).maybeSingle(),
    admin
      .from("restaurant_loyalty_stats")
      .select("completed_orders, revenue_cents")
      .eq("restaurant_user_id", restaurantUserId)
      .maybeSingle(),
    loadRestaurantTiers(admin),
    admin
      .from("restaurant_active_benefits")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_user_id", restaurantUserId)
      .in("status", ["scheduled", "active"]),
    ensureRestaurantReferralCode(admin, restaurantUserId),
  ]);

  const lifetime = Number(account?.lifetime_points ?? 0);
  const completedOrders = Number(stats?.completed_orders ?? 0);
  const revenueCents = Number(stats?.revenue_cents ?? 0);
  const tierCode = (account?.tier_code as string) || "standard";
  const currentTier = tiers.find((t) => t.code === tierCode) ?? null;
  const tierLabel = currentTier?.label ?? "Standard";

  // The next tier is the first ladder step the restaurant does not yet meet.
  const nextTier =
    tiers.find(
      (t) =>
        t.sort_order > (currentTier?.sort_order ?? 0) &&
        (lifetime < t.min_points ||
          completedOrders < t.min_completed_orders ||
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
    completed_orders: completedOrders,
    revenue_cents: revenueCents,
    currency: (settings?.currency as string) || "USD",
    active_benefits_count: Number(benefitsCount ?? 0),
    referral_code: referralCode,
    referral_link: referralCode ? `${REFERRAL_BASE_URL}/${referralCode}` : null,
  };
}
