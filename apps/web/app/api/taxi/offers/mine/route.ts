import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const nowIso = new Date().toISOString();

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_offers")
      .select(
        `
        *,
        taxi_rides:taxi_ride_id (
          id,
          status,
          pickup_address,
          dropoff_address,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng,
          driver_payout_cents,
          total_cents,
          vehicle_class,
          payment_status,
          preferred_driver_id,
          is_scheduled,
          scheduled_pickup_at,
          stop_count,
          premium_driver_only,
          business_trip_type,
          is_shared_ride,
          shared_ride_id,
          taxi_ride_stops (
            id,
            stop_order,
            address,
            lat,
            lng,
            status
          )
        )
      `
      )
      .eq("driver_id", auth.user.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const offers = data ?? [];
    for (const offer of offers) {
      const ride = offer.taxi_rides as Record<string, unknown> | null;
      const sharedRideId = ride?.shared_ride_id;
      if (!sharedRideId) continue;

      const { data: passengers } = await auth.supabaseAdmin
        .from("taxi_shared_ride_passengers")
        .select(
          "id,segment_order,pickup_address,dropoff_address,share_discount_cents,status,client_user_id"
        )
        .eq("shared_ride_id", String(sharedRideId))
        .order("segment_order", { ascending: true });

      if (ride) {
        ride.shared_passengers = passengers ?? [];
      }
    }

    return taxiJson({ ok: true, offers });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
