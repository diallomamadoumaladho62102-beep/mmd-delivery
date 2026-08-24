import { NextRequest } from "next/server";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  getTaxiRideId,
  normalizeStatus,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { resolveTaxiRoute } from "@/lib/taxiMapbox";
import { assertRouteDistanceWithinLimit } from "@/lib/routeDistanceLimits";
import {
  getTaxiMinRemainingMilesForDestChange,
  milesBetween,
} from "@/lib/taxi/taxiCancellationPolicy";
import { logTaxiEventServer } from "@/lib/taxiEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client requests a destination change. Backend recalculates route + pricing.
 * Never trusts client-supplied totals. Enforces 300mi taxi max.
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
    const newAddress = String(
      body.dropoff_address ?? body.dropoffAddress ?? "",
    ).trim();
    const newLat = Number(body.dropoff_lat ?? body.dropoffLat);
    const newLng = Number(body.dropoff_lng ?? body.dropoffLng);

    if (!newAddress && !(Number.isFinite(newLat) && Number.isFinite(newLng))) {
      return taxiJson({ ok: false, error: "new_destination_required" }, 400);
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
        "id,status,payment_status,driver_id,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,distance_miles,total_cents,driver_payout_cents,subtotal_cents,tax_cents,service_fee_cents,vehicle_class,country_code,currency,passenger_count",
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
      return taxiJson({ ok: false, error: "destination_change_not_allowed" }, 400);
    }

    // Abuse guard: if in progress and nearly at old destination, block large free pivot.
    if (
      status === "in_progress" &&
      ride.driver_id &&
      Number.isFinite(Number(ride.dropoff_lat)) &&
      Number.isFinite(Number(ride.dropoff_lng))
    ) {
      try {
        const { data: loc } = await auth.supabaseAdmin
          .from("driver_locations")
          .select("lat,lng")
          .eq("driver_id", String(ride.driver_id))
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
          const remaining = milesBetween(
            { lat: Number(loc.lat), lng: Number(loc.lng) },
            {
              lat: Number(ride.dropoff_lat),
              lng: Number(ride.dropoff_lng),
            },
          );
          if (remaining < getTaxiMinRemainingMilesForDestChange()) {
            return taxiJson(
              {
                ok: false,
                error: "destination_change_too_late",
                message:
                  "Destination cannot be changed this close to arrival. Contact support if needed.",
                remaining_miles: remaining,
              },
              400,
            );
          }
        }
      } catch {
        // continue — location unavailable should not hard-block legitimate changes
      }
    }

    let route;
    try {
      route = await resolveTaxiRoute({
        pickupLat: Number(ride.pickup_lat),
        pickupLng: Number(ride.pickup_lng),
        pickupAddress: String(ride.pickup_address ?? ""),
        dropoffLat: Number.isFinite(newLat) ? newLat : undefined,
        dropoffLng: Number.isFinite(newLng) ? newLng : undefined,
        dropoffAddress: newAddress || undefined,
      });
      assertRouteDistanceWithinLimit(route.distanceMiles, "taxi");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "route_unavailable";
      if (
        message === "taxi_distance_too_far" ||
        message === "distance_too_far"
      ) {
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

    if (quoteError) {
      return taxiJson({ ok: false, error: quoteError.message }, 500);
    }
    const quoteObj = (quote ?? {}) as Record<string, unknown>;
    if (quoteObj.ok === false) {
      return taxiJson({ ok: false, ...quoteObj }, 400);
    }

    const newTotal = Math.round(Number(quoteObj.total_cents ?? 0));
    const newDriver = Math.round(Number(quoteObj.driver_payout_cents ?? 0));
    const oldTotal = Math.round(Number(ride.total_cents ?? 0));
    const delta = newTotal - oldTotal;

    const preview = {
      old_dropoff_address: ride.dropoff_address,
      new_dropoff_address: route.dropoffAddress ?? newAddress,
      old_distance_miles: Number(ride.distance_miles ?? 0),
      new_distance_miles: route.distanceMiles,
      old_total_cents: oldTotal,
      new_total_cents: newTotal,
      price_delta_cents: delta,
      new_driver_payout_cents: newDriver,
      requires_additional_payment: delta > 1,
      refund_delta_cents: delta < -1 ? Math.abs(delta) : 0,
    };

    if (!confirm) {
      return taxiJson({
        ok: true,
        preview: true,
        taxi_ride_id: rideId,
        change: preview,
        message:
          "Confirm to apply the new destination. Price is recalculated on the server.",
      });
    }

    // Paid rides with higher price: require additional charge path — do not silently undercharge.
    if (
      normalizeStatus(ride.payment_status) === "paid" &&
      delta > 1
    ) {
      return taxiJson(
        {
          ok: false,
          error: "additional_payment_required",
          change: preview,
          message:
            "The new destination increases the fare. Additional payment is required before applying.",
        },
        402,
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await auth.supabaseAdmin
      .from("taxi_rides")
      .update({
        dropoff_address: route.dropoffAddress ?? newAddress,
        dropoff_lat: route.dropoffLat,
        dropoff_lng: route.dropoffLng,
        distance_miles: route.distanceMiles,
        duration_minutes: route.durationMinutes,
        subtotal_cents: Math.round(Number(quoteObj.subtotal_cents ?? 0)),
        tax_cents: Math.round(Number(quoteObj.tax_cents ?? 0)),
        total_cents: newTotal,
        driver_payout_cents: newDriver,
        platform_fee_cents: Math.round(Number(quoteObj.platform_fee_cents ?? 0)),
        updated_at: now,
      })
      .eq("id", rideId)
      .eq("status", ride.status)
      .select("id")
      .maybeSingle();

    if (updErr) return taxiJson({ ok: false, error: updErr.message }, 500);
    if (!updated) {
      return taxiJson({ ok: false, error: "status_changed_retry" }, 409);
    }

    await auth.supabaseAdmin.from("taxi_ride_route_changes").insert({
      taxi_ride_id: rideId,
      change_type: "destination",
      requested_by: auth.user.id,
      old_dropoff_address: ride.dropoff_address,
      old_dropoff_lat: ride.dropoff_lat,
      old_dropoff_lng: ride.dropoff_lng,
      new_dropoff_address: route.dropoffAddress ?? newAddress,
      new_dropoff_lat: route.dropoffLat,
      new_dropoff_lng: route.dropoffLng,
      old_distance_miles: ride.distance_miles,
      new_distance_miles: route.distanceMiles,
      old_total_cents: oldTotal,
      new_total_cents: newTotal,
      old_driver_payout_cents: ride.driver_payout_cents,
      new_driver_payout_cents: newDriver,
      metadata: { price_delta_cents: delta },
    });

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId,
      eventType: "destination_changed",
      oldStatus: status,
      newStatus: status,
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client changed taxi destination",
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
