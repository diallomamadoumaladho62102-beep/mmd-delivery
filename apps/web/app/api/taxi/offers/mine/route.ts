import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { formatClientPreferencesForDriver } from "@/lib/taxiClientPreferences";
import { isLiveVisibleTrip } from "@/lib/tripVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function enrichOffer(offer: Record<string, unknown>) {
  const ride = offer.taxi_rides as Record<string, unknown> | null;
  if (!ride) return offer;

  const preference_lines = formatClientPreferencesForDriver({
    clientPreferences: ride.client_preferences as Record<string, unknown>,
    preferElectricOrHybrid: ride.prefer_electric_or_hybrid === true,
    ambiance: String(ride.ambiance_preference ?? "none"),
  });

  return {
    ...offer,
    client_preference_lines: preference_lines,
    taxi_rides: {
      ...ride,
      client_preference_lines: preference_lines,
      preferences_client_message: ride.preferences_client_message ?? null,
      preferences_unmet: ride.preferences_unmet ?? [],
    },
  };
}

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
          client_preferences,
          ambiance_preference,
          prefer_electric_or_hybrid,
          preferences_client_message,
          preferences_unmet,
          preferences_dispatch_stage,
          is_test,
          hidden_from_user,
          archived_at,
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

    const offers = (data ?? [])
      .map((offer) => enrichOffer(offer as Record<string, unknown>))
      .filter((offer) => {
        const ride = offer.taxi_rides as Record<string, unknown> | null;
        if (!ride) return false;
        return isLiveVisibleTrip({
          is_test: ride.is_test as boolean | null | undefined,
          hidden_from_user: ride.hidden_from_user as boolean | null | undefined,
          archived_at: ride.archived_at as string | null | undefined,
        });
      });
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
