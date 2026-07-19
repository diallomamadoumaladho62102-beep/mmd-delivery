import { NextRequest, NextResponse } from "next/server";
import { requireRestaurantApiUser } from "@/lib/restaurantCommandCenterAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Available reward catalogue for the authenticated restaurant + its currently
 * active professional benefits. Eligibility (city / eligible list / quota) is
 * pre-filtered here for display; the authoritative checks live in the redeem RPC.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRestaurantApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, restaurantUserId } = auth.ctx;

    const nowIso = new Date().toISOString();

    const [{ data: rewards }, { data: benefits }, { data: profile }] = await Promise.all([
      admin
        .from("restaurant_rewards")
        .select(
          "id, name, description, points_cost, benefit_type, benefit_value, benefit_currency, duration_days, city, eligible_restaurant_ids, ends_at, max_redemptions, redemptions_count"
        )
        .eq("status", "active")
        .order("points_cost", { ascending: true }),
      admin
        .from("restaurant_active_benefits")
        .select("id, benefit_type, benefit_value, benefit_currency, starts_at, expires_at, status, reward_id")
        .eq("restaurant_user_id", restaurantUserId)
        .in("status", ["scheduled", "active"])
        .order("expires_at", { ascending: true }),
      admin.from("restaurant_profiles").select("city").eq("user_id", restaurantUserId).maybeSingle(),
    ]);

    const city = String(profile?.city ?? "").trim().toLowerCase();

    const available = ((rewards ?? []) as Array<Record<string, unknown>>).filter((r) => {
      const endsAt = r.ends_at ? String(r.ends_at) : null;
      if (endsAt && endsAt <= nowIso) return false;
      const max = r.max_redemptions == null ? null : Number(r.max_redemptions);
      if (max != null && Number(r.redemptions_count ?? 0) >= max) return false;
      const rewardCity = r.city ? String(r.city).trim().toLowerCase() : null;
      if (rewardCity && rewardCity !== city) return false;
      const eligible = (r.eligible_restaurant_ids as string[] | null) ?? null;
      if (eligible && !eligible.includes(restaurantUserId)) return false;
      return true;
    });

    return NextResponse.json({ ok: true, rewards: available, active_benefits: benefits ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
