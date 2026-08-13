import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_loyalty_accounts")
      .select("user_id, points_balance, lifetime_points, tier, updated_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    // Real client taxi stats for Taxi Loyalty "Driver Rating" block (Figma).
    // completed_rides = client's completed trips; avg_driver_rating = mean of
    // driver_rating_snapshot on those rides (quality of drivers they've used).
    const { data: rideRows, error: ridesError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("driver_rating_snapshot")
      .eq("client_user_id", auth.user.id)
      .eq("status", "completed");

    if (ridesError) {
      return taxiJson({ ok: false, error: ridesError.message }, 500);
    }

    const completedRides = rideRows?.length ?? 0;
    const ratingValues = (rideRows ?? [])
      .map((row) => Number(row.driver_rating_snapshot))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avgDriverRating =
      ratingValues.length > 0
        ? Math.round(
            (ratingValues.reduce((sum, n) => sum + n, 0) / ratingValues.length) *
              10
          ) / 10
        : null;

    const account = data ?? {
      user_id: auth.user.id,
      points_balance: 0,
      lifetime_points: 0,
      tier: "bronze",
    };

    return taxiJson({
      ok: true,
      account: {
        ...account,
        completed_rides: completedRides,
        avg_driver_rating: avgDriverRating,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
