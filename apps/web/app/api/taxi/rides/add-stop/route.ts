import { NextRequest } from "next/server";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  getTaxiRideId,
  normalizeStatus,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { assertRouteDistanceWithinLimit } from "@/lib/routeDistanceLimits";
import { getTaxiMaxStops } from "@/lib/taxi/taxiCancellationPolicy";
import { logTaxiEventServer } from "@/lib/taxiEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client adds a stop. Backend recalculates full multi-leg route + pricing.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let rideId = "";
    try {
      rideId = getTaxiRideId(body);
    } catch (e: unknown) {
      return taxiJson(
        { ok: false, error: e instanceof Error ? e.message : "Invalid request" },
        400,
      );
    }

    const confirm = body.confirm === true;
    const stopAddress = String(body.stop_address ?? body.address ?? "").trim();
    const stopLat = Number(body.stop_lat ?? body.lat);
    const stopLng = Number(body.stop_lng ?? body.lng);
    if (!stopAddress && !(Number.isFinite(stopLat) && Number.isFinite(stopLng))) {
      return taxiJson({ ok: false, error: "stop_required" }, 400);
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const scope = await assertClientOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });
    if (scope.ok === false) {
      return taxiJson({ ok: false, error: scope.error }, scope.status);
    }

    const { data: ride, error } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select(
        "id,status,payment_status,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,distance_miles,total_cents,driver_payout_cents,vehicle_class,country_code,passenger_count",
      )
      .eq("id", rideId)
      .maybeSingle();
    if (error) return taxiJson({ ok: false, error: error.message }, 500);
    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);

    const status = normalizeStatus(ride.status);
    if (
      !["paid", "dispatching", "accepted", "driver_arrived", "in_progress"].includes(
        status,
      )
    ) {
      return taxiJson({ ok: false, error: "add_stop_not_allowed" }, 400);
    }

    const { data: existingStops } = await auth.supabaseAdmin
      .from("taxi_ride_stops")
      .select("id,stop_order,address,lat,lng,status")
      .eq("taxi_ride_id", rideId)
      .order("stop_order", { ascending: true });

    const pendingStops = (existingStops ?? []).filter(
      (s) => String(s.status ?? "").toLowerCase() !== "completed",
    );
    const maxStops = getTaxiMaxStops();
    if ((existingStops ?? []).length >= maxStops) {
      return taxiJson(
        {
          ok: false,
          error: "max_stops_reached",
          message: `Maximum of ${maxStops} stops allowed.`,
          max_stops: maxStops,
        },
        400,
      );
    }

    const stopInputs = [
      ...(existingStops ?? []).map((s) => ({
        address: String(s.address ?? ""),
        lat: Number(s.lat),
        lng: Number(s.lng),
      })),
      {
        address: stopAddress || undefined,
        lat: Number.isFinite(stopLat) ? stopLat : undefined,
        lng: Number.isFinite(stopLng) ? stopLng : undefined,
      },
    ];

    let route;
    try {
      route = await resolveTaxiMultiStopRoute({
        pickupLat: Number(ride.pickup_lat),
        pickupLng: Number(ride.pickup_lng),
        pickupAddress: String(ride.pickup_address ?? ""),
        dropoffLat: Number(ride.dropoff_lat),
        dropoffLng: Number(ride.dropoff_lng),
        dropoffAddress: String(ride.dropoff_address ?? ""),
        stops: stopInputs,
      });
      assertRouteDistanceWithinLimit(route.distanceMiles, "taxi");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "route_unavailable";
      if (message === "taxi_distance_too_far" || message === "distance_too_far") {
        return taxiJson(
          {
            ok: false,
            error: "taxi_distance_too_far",
            message:
              "This trip exceeds the maximum allowed taxi distance of 300 miles.",
          },
          400,
        );
      }
      return taxiJson({ ok: false, error: message }, 400);
    }

    const { data: quote, error: quoteError } = await auth.supabaseAdmin.rpc(
      "quote_taxi_ride",
      {
        p_distance_miles: route.distanceMiles,
        p_duration_minutes: route.durationMinutes,
        p_vehicle_class: String(ride.vehicle_class ?? "standard"),
        p_country_code: String(ride.country_code ?? "US"),
        p_passenger_count: Math.max(1, Number(ride.passenger_count ?? 1)),
      },
    );
    if (quoteError) return taxiJson({ ok: false, error: quoteError.message }, 500);
    const quoteObj = (quote ?? {}) as Record<string, unknown>;
    if (quoteObj.ok === false) return taxiJson({ ok: false, ...quoteObj }, 400);

    const newTotal = Math.round(Number(quoteObj.total_cents ?? 0));
    const oldTotal = Math.round(Number(ride.total_cents ?? 0));
    const delta = newTotal - oldTotal;
    const newStop = route.stops[route.stops.length - 1];

    const preview = {
      stop: newStop,
      stop_count: route.stops.length,
      max_stops: maxStops,
      old_distance_miles: Number(ride.distance_miles ?? 0),
      new_distance_miles: route.distanceMiles,
      old_total_cents: oldTotal,
      new_total_cents: newTotal,
      price_delta_cents: delta,
      pending_stops: pendingStops.length,
    };

    if (!confirm) {
      return taxiJson({
        ok: true,
        preview: true,
        taxi_ride_id: rideId,
        change: preview,
      });
    }

    if (normalizeStatus(ride.payment_status) === "paid" && delta > 1) {
      return taxiJson(
        {
          ok: false,
          error: "additional_payment_required",
          change: preview,
          message:
            "Adding this stop increases the fare. Additional payment is required before applying.",
        },
        402,
      );
    }

    const nextOrder = (existingStops ?? []).length + 1;
    const { error: stopErr } = await auth.supabaseAdmin
      .from("taxi_ride_stops")
      .insert({
        taxi_ride_id: rideId,
        stop_order: nextOrder,
        address: newStop?.address ?? stopAddress,
        lat: newStop?.lat ?? stopLat,
        lng: newStop?.lng ?? stopLng,
        status: "pending",
      });
    if (stopErr) return taxiJson({ ok: false, error: stopErr.message }, 500);

    await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        distance_miles: route.distanceMiles,
        duration_minutes: route.durationMinutes,
        subtotal_cents: Math.round(Number(quoteObj.subtotal_cents ?? 0)),
        tax_cents: Math.round(Number(quoteObj.tax_cents ?? 0)),
        total_cents: newTotal,
        driver_payout_cents: Math.round(Number(quoteObj.driver_payout_cents ?? 0)),
        platform_fee_cents: Math.round(Number(quoteObj.platform_fee_cents ?? 0)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", rideId);

    await auth.supabaseAdmin.from("taxi_ride_route_changes").insert({
      taxi_ride_id: rideId,
      change_type: "add_stop",
      requested_by: auth.user.id,
      stop_address: newStop?.address ?? stopAddress,
      stop_lat: newStop?.lat ?? stopLat,
      stop_lng: newStop?.lng ?? stopLng,
      old_distance_miles: ride.distance_miles,
      new_distance_miles: route.distanceMiles,
      old_total_cents: oldTotal,
      new_total_cents: newTotal,
      old_driver_payout_cents: ride.driver_payout_cents,
      new_driver_payout_cents: quoteObj.driver_payout_cents,
    });

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "stop_added",
      oldStatus: status,
      newStatus: status,
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client added a taxi stop",
      metadata: preview,
    });

    return taxiJson({
      ok: true,
      applied: true,
      taxi_ride_id: rideId,
      change: preview,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
