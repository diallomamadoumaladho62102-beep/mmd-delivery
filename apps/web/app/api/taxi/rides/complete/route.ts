import { NextRequest } from "next/server";
import {
  assertDriverOwnsTaxiRide,
  getProfileRole,
  getTaxiRideId,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import {
  assertTaxiDropoffProximity,
  parseRequiredTaxiGps,
} from "@/lib/taxiProximityGate";
import {
  runTaxiRideCompletionSideEffects,
  type TaxiCompleteRideRow,
} from "@/lib/taxiCompleteRideCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let rideId = "";

    try {
      rideId = getTaxiRideId(body);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return taxiJson({ ok: false, error: message }, 400);
    }

    const gps = parseRequiredTaxiGps(body);
    if (gps.ok === false) {
      return taxiJson({ ok: false, error: gps.error }, 400);
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const ownership = await assertDriverOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });
    if (ownership.ok === false) {
      return taxiJson({ ok: false, error: ownership.error }, ownership.status);
    }

    // Ownership already verified above. Load dropoff + preference fields only
    // (taxi_rides has client_user_id; never select a nonexistent column here —
    // PostgREST then returns data=null and was wrongly mapped to ride_not_found).
    const { data: rideBeforeComplete, error: rideLoadError } =
      await auth.supabaseAdmin
        .from("taxi_rides")
        .select(
          "id,status,payment_status,client_user_id,driver_id,client_preferences,ambiance_preference,country_code,vehicle_class,assigned_fuel_type,prefer_electric_or_hybrid,dropoff_lat,dropoff_lng",
        )
        .eq("id", rideId)
        .maybeSingle();

    if (rideLoadError) {
      return taxiJson({ ok: false, error: rideLoadError.message }, 500);
    }

    if (!rideBeforeComplete) {
      return taxiJson({ ok: false, error: "ride_not_found" }, 404);
    }

    // Drivers MUST stay GPS-gated — no admin bypass on this endpoint.
    const proximity = assertTaxiDropoffProximity({
      driverLat: gps.lat,
      driverLng: gps.lng,
      dropoffLat: rideBeforeComplete.dropoff_lat,
      dropoffLng: rideBeforeComplete.dropoff_lng,
    });

    if (proximity.ok === false) {
      return taxiJson(
        {
          ok: false,
          error: proximity.error,
          distance_meters: proximity.distanceMeters,
        },
        400,
      );
    }

    const { data, error } = await auth.supabaseUser.rpc("driver_complete_taxi_ride", {
      p_ride_id: rideId,
      p_lat: gps.lat,
      p_lng: gps.lng,
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? null) as TaxiRpcResult | null;

    if (!result?.ok) {
      const mapped = mapTaxiRpcError(result?.message ?? result?.error ?? "");
      return taxiJson({ ok: false, error: mapped.message }, mapped.status);
    }

    const sideEffects = await runTaxiRideCompletionSideEffects({
      supabaseAdmin: auth.supabaseAdmin,
      ride: rideBeforeComplete as TaxiCompleteRideRow,
      rideId,
      actorId: auth.user.id,
      triggeredRole: "driver",
      eventType: "ride_completed",
      description: "Driver completed taxi ride via API (GPS gated)",
      metadata: {
        commissions: (result as Record<string, unknown>).commissions ?? null,
      },
      distanceMeters: proximity.distanceMeters,
    });

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      result,
      distance_meters: proximity.distanceMeters,
      driver_payout: sideEffects.driver_payout,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
