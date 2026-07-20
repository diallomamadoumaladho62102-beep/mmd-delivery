import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();

    const { count: totalFavorites, error: favError } = await supabase
      .from("taxi_client_favorite_drivers")
      .select("*", { count: "exact", head: true });

    if (favError) return json({ ok: false, error: favError.message }, 500);

    const { data: topDrivers, error: topError } = await supabase
      .from("taxi_client_favorite_drivers")
      .select("driver_user_id")
      .limit(5000);

    if (topError) return json({ ok: false, error: topError.message }, 500);

    const counts = new Map<string, number>();
    for (const row of topDrivers ?? []) {
      const id = String(row.driver_user_id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const ranked = Array.from(counts.entries())
      .map(([driver_user_id, favorite_count]) => ({ driver_user_id, favorite_count }))
      .sort((a, b) => b.favorite_count - a.favorite_count)
      .slice(0, 20);

    const { count: ridesWithPreferred, error: rideError } = await applyLiveTripFilters(
      supabase
        .from("taxi_rides")
        .select("*", { count: "exact", head: true })
        .not("preferred_driver_id", "is", null)
    );

    if (rideError) return json({ ok: false, error: rideError.message }, 500);

    return json({
      ok: true,
      stats: {
        total_favorites: totalFavorites ?? 0,
        unique_drivers_favorited: counts.size,
        rides_with_preferred_driver: ridesWithPreferred ?? 0,
        top_drivers: ranked,
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
