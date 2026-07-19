import { NextRequest, NextResponse } from "next/server";
import { requireRestaurantApiUser } from "@/lib/restaurantCommandCenterAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRestaurantApiUser(req);
    if (auth.ok === false) {
      return NextResponse.json({ ok: false, error: auth.message }, { status: auth.status });
    }
    const { admin, restaurantUserId } = auth.ctx;
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));

    const [points, awards, redemptions] = await Promise.all([
      admin
        .from("loyalty_ledger")
        .select(
          "id, delta_points, balance_after, entry_type, reference_type, reference_id, description, created_at"
        )
        .eq("user_id", restaurantUserId)
        .eq("role", "restaurant")
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("restaurant_loyalty_awards")
        .select("id, rule_id, period_key, metric_value, threshold, points_awarded, source, created_at")
        .eq("restaurant_user_id", restaurantUserId)
        .order("created_at", { ascending: false })
        .limit(limit),
      admin
        .from("restaurant_loyalty_redemptions")
        .select("id, reward_id, points_spent, status, reason, created_at")
        .eq("restaurant_user_id", restaurantUserId)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (points.error) return NextResponse.json({ ok: false, error: points.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      points: points.data ?? [],
      awards: awards.data ?? [],
      redemptions: redemptions.data ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
