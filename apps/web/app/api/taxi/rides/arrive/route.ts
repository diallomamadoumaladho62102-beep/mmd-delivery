import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { getTaxiRideId, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { mapTaxiRpcError, type TaxiRpcResult } from "@/lib/taxiDriver";
import {
  assertTaxiPickupProximity,
  parseRequiredTaxiGps,
} from "@/lib/taxiProximityGate";

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

    const { data: ride, error: rideError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id,status,driver_id,pickup_lat,pickup_lng")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) {
      return taxiJson({ ok: false, error: rideError.message }, 500);
    }
    if (!ride) {
      return taxiJson({ ok: false, error: "ride_not_found" }, 404);
    }

    const proximity = assertTaxiPickupProximity({
      driverLat: gps.lat,
      driverLng: gps.lng,
      pickupLat: ride.pickup_lat,
      pickupLng: ride.pickup_lng,
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

    const { data, error } = await auth.supabaseUser.rpc("driver_arrive_taxi_pickup", {
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
      return taxiJson(
        {
          ok: false,
          error: mapped.message,
          distance_meters: (result as Record<string, unknown> | null)?.distance_meters ?? null,
        },
        mapped.status,
      );
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "driver_arrived",
      newStatus: "driver_arrived",
      actorId: auth.user.id,
      triggeredRole: "driver",
      description: "Driver arrived at taxi pickup via API (GPS gated)",
      metadata: { distance_meters: proximity.distanceMeters },
    });

    return taxiJson({
      ok: true,
      taxi_ride_id: rideId,
      result,
      distance_meters: proximity.distanceMeters,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
