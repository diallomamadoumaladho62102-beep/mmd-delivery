import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * GET without userId  -> paged list of seller loyalty accounts (filterable).
 * GET with ?userId=... -> full detail for one seller (account, stats, ledger,
 * redemptions, active benefits, referrals, seller profile).
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.marketplace.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const userId = String(params.get("userId") ?? "").trim();

    if (userId) {
      if (!UUID_RE.test(userId)) return json({ ok: false, error: "Invalid userId" }, 400);

      const [account, stats, ledger, redemptions, benefits, referrals, seller] = await Promise.all([
        supabase
          .from("loyalty_accounts")
          .select("points_balance, lifetime_points, tier_code, status, created_at, updated_at")
          .eq("user_id", userId)
          .eq("role", "seller")
          .maybeSingle(),
        supabase
          .from("marketplace_loyalty_stats")
          .select("completed_sales, revenue_cents, first_sale_at, last_sale_at")
          .eq("seller_user_id", userId)
          .maybeSingle(),
        supabase
          .from("loyalty_ledger")
          .select("id, delta_points, balance_after, entry_type, reference_type, reference_id, description, created_at")
          .eq("user_id", userId)
          .eq("role", "seller")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("marketplace_loyalty_redemptions")
          .select("id, reward_id, points_spent, status, reason, created_at")
          .eq("seller_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("marketplace_active_benefits")
          .select("id, benefit_type, benefit_value, benefit_currency, starts_at, expires_at, status")
          .eq("seller_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("marketplace_referrals")
          .select("id, referrer_user_id, referred_user_id, status, created_at")
          .or(`referrer_user_id.eq.${userId},referred_user_id.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("sellers")
          .select("business_name, city, country_code, status")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      return json({
        ok: true,
        detail: {
          user_id: userId,
          seller: seller.data ?? null,
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
      .eq("role", "seller")
      .order("lifetime_points", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (tier) query = query.eq("tier_code", tier);

    const { data: accounts, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const ids = (accounts ?? []).map((a) => String(a.user_id));
    let sellersById: Record<string, { business_name: string | null; city: string | null }> = {};
    if (ids.length > 0) {
      const { data: sellers } = await supabase
        .from("sellers")
        .select("user_id, business_name, city")
        .in("user_id", ids);
      sellersById = Object.fromEntries(
        (sellers ?? []).map((s) => [
          String(s.user_id),
          { business_name: (s.business_name as string) ?? null, city: (s.city as string) ?? null },
        ])
      );
    }

    const rows = (accounts ?? []).map((a) => ({
      ...a,
      business_name: sellersById[String(a.user_id)]?.business_name ?? null,
      city: sellersById[String(a.user_id)]?.city ?? null,
    }));

    return json({ ok: true, accounts: rows });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
