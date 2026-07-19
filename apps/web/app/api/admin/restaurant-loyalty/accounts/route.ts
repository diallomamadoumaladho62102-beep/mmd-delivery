import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * GET without userId  -> paged list of restaurant loyalty accounts (filterable).
 * GET with ?userId=... -> full detail for one restaurant (account, stats,
 * ledger, redemptions, active benefits, referrals).
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.restaurant.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const userId = String(params.get("userId") ?? "").trim();

    if (userId) {
      if (!UUID_RE.test(userId)) return json({ ok: false, error: "Invalid userId" }, 400);

      const [account, stats, ledger, redemptions, benefits, referrals, profile] = await Promise.all([
        supabase
          .from("loyalty_accounts")
          .select("points_balance, lifetime_points, tier_code, status, created_at, updated_at")
          .eq("user_id", userId)
          .eq("role", "restaurant")
          .maybeSingle(),
        supabase
          .from("restaurant_loyalty_stats")
          .select("completed_orders, revenue_cents, first_order_at, last_order_at")
          .eq("restaurant_user_id", userId)
          .maybeSingle(),
        supabase
          .from("loyalty_ledger")
          .select("id, delta_points, balance_after, entry_type, reference_type, reference_id, description, created_at")
          .eq("user_id", userId)
          .eq("role", "restaurant")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("restaurant_loyalty_redemptions")
          .select("id, reward_id, points_spent, status, reason, created_at")
          .eq("restaurant_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("restaurant_active_benefits")
          .select("id, benefit_type, benefit_value, benefit_currency, starts_at, expires_at, status")
          .eq("restaurant_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("restaurant_referrals")
          .select("id, referrer_user_id, referred_user_id, status, created_at")
          .or(`referrer_user_id.eq.${userId},referred_user_id.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("restaurant_profiles")
          .select("restaurant_name, city, status")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      return json({
        ok: true,
        detail: {
          user_id: userId,
          profile: profile.data ?? null,
          account: account.data ?? null,
          stats: stats.data ?? null,
          ledger: ledger.data ?? [],
          redemptions: redemptions.data ?? [],
          active_benefits: benefits.data ?? [],
          referrals: referrals.data ?? [],
        },
      });
    }

    // List
    const status = String(params.get("status") ?? "").trim();
    const tier = String(params.get("tier") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("loyalty_accounts")
      .select("user_id, points_balance, lifetime_points, tier_code, status, updated_at")
      .eq("role", "restaurant")
      .order("lifetime_points", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (tier) query = query.eq("tier_code", tier);

    const { data: accounts, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const ids = (accounts ?? []).map((a) => String(a.user_id));
    let profilesById: Record<string, { restaurant_name: string | null; city: string | null }> = {};
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from("restaurant_profiles")
        .select("user_id, restaurant_name, city")
        .in("user_id", ids);
      profilesById = Object.fromEntries(
        (profiles ?? []).map((p) => [
          String(p.user_id),
          { restaurant_name: (p.restaurant_name as string) ?? null, city: (p.city as string) ?? null },
        ])
      );
    }

    const rows = (accounts ?? []).map((a) => ({
      ...a,
      restaurant_name: profilesById[String(a.user_id)]?.restaurant_name ?? null,
      city: profilesById[String(a.user_id)]?.city ?? null,
    }));

    return json({ ok: true, accounts: rows });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
