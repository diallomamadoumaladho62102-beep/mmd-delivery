import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiCountryWithDetection } from "@/lib/taxiCountryDetection";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StopBody = {
  address?: string;
  lat?: number;
  lng?: number;
};

type Body = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  vehicleClass?: string;
  vehicle_class?: string;
  passengerCount?: number;
  passenger_count?: number;
  countryCode?: string;
  country_code?: string;
  clientNotes?: string;
  client_notes?: string;
  scheduledPickupAt?: string;
  scheduled_pickup_at?: string;
  preferredDriverId?: string;
  preferred_driver_id?: string;
  promoCode?: string;
  promo_code?: string;
  rewardId?: string;
  reward_id?: string;
  stops?: StopBody[];
};

const QUOTE_DRIFT_TOLERANCE_CENTS = 50;
const QUOTE_DRIFT_TOLERANCE_RATIO = 0.02;

function isQuotePriceWithinTolerance(expected: number, actual: number) {
  if (!Number.isFinite(expected) || expected <= 0) return true;
  if (!Number.isFinite(actual) || actual <= 0) return false;
  const diff = Math.abs(actual - expected);
  const maxDiff = Math.max(
    QUOTE_DRIFT_TOLERANCE_CENTS,
    Math.round(expected * QUOTE_DRIFT_TOLERANCE_RATIO)
  );
  return diff <= maxDiff;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Body;
    const scheduledPickupAt = String(
      body.scheduledPickupAt ?? body.scheduled_pickup_at ?? ""
    ).trim();

    if (!scheduledPickupAt) {
      return taxiJson({ ok: false, error: "Missing scheduled_pickup_at" }, 400);
    }

    const pickupTime = Date.parse(scheduledPickupAt);
    if (!Number.isFinite(pickupTime)) {
      return taxiJson({ ok: false, error: "Invalid scheduled_pickup_at" }, 400);
    }

    if (pickupTime <= Date.now() + 15 * 60 * 1000) {
      return taxiJson(
        { ok: false, error: "scheduled_pickup_too_soon" },
        400
      );
    }

    const vehicleClass = String(
      body.vehicleClass ?? body.vehicle_class ?? "standard"
    ).trim();
    const passengerCount = Math.max(
      1,
      Number(body.passengerCount ?? body.passenger_count ?? 1)
    );
    const manualCountryCode = normalizeTaxiCountryCode(
      body.countryCode ?? body.country_code ?? "US"
    );
    const clientNotes = String(
      body.clientNotes ?? body.client_notes ?? ""
    ).trim();
    const preferredDriverId = String(
      body.preferredDriverId ?? body.preferred_driver_id ?? ""
    ).trim();
    const promoCode = String(body.promoCode ?? body.promo_code ?? "").trim();
    const rewardId = String(body.rewardId ?? body.reward_id ?? "").trim();

    let route;
    try {
      route = await resolveTaxiMultiStopRoute({
        ...body,
        stops: body.stops,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Route resolution failed";
      if (message === "distance_too_far") {
        return taxiJson({ ok: false, error: "distance_too_far" }, 400);
      }
      return taxiJson({ ok: false, error: message }, 400);
    }

    const countryResult = await resolveTaxiCountryWithDetection({
      manualCountryCode,
      pickupLat: route.pickupLat,
      pickupLng: route.pickupLng,
    });

    if (countryResult.ok === false) {
      return taxiJson({ ok: false, ...countryResult }, 400);
    }

    const countryCode = countryResult.resolution.countryCode;

    const platformCheck = await assertPlatformFeature(
      auth.supabaseAdmin,
      countryCode,
      "taxi",
      "active"
    );
    if (platformCheck.ok === false) {
      return taxiJson({ ok: false, ...platformCheck }, 403);
    }

    const launchConfig = await fetchTaxiCountryLaunchConfig(
      auth.supabaseAdmin,
      countryCode
    );
    if (!launchConfig) {
      return taxiJson({ ok: false, error: "country_launch_config_missing" }, 400);
    }

    const scheduledCheck = assertTaxiLaunchFeature(launchConfig, "scheduled");
    if (scheduledCheck.ok === false) {
      return taxiJson({ ok: false, ...scheduledCheck }, 400);
    }

    const { data: quote, error: quoteError } = await auth.supabaseAdmin.rpc(
      "quote_taxi_ride",
      {
        p_distance_miles: route.distanceMiles,
        p_duration_minutes: route.durationMinutes,
        p_vehicle_class: vehicleClass,
        p_country_code: countryCode,
        p_passenger_count: passengerCount,
      }
    );

    if (quoteError) {
      return taxiJson({ ok: false, error: quoteError.message }, 500);
    }

    const quoteObj = (quote ?? {}) as Record<string, unknown>;
    if (quoteObj.ok === false) {
      return taxiJson({ ok: false, ...quoteObj }, 400);
    }

    const pickupAddress =
      route.pickupAddress ||
      body.pickupAddress?.trim() ||
      `${route.pickupLat}, ${route.pickupLng}`;
    const dropoffAddress =
      route.dropoffAddress ||
      body.dropoffAddress?.trim() ||
      `${route.dropoffLat}, ${route.dropoffLng}`;

    const { data: ride, error: insertError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .insert({
        client_user_id: auth.user.id,
        vehicle_class: vehicleClass,
        status: "quoted",
        pickup_address: pickupAddress,
        pickup_lat: route.pickupLat,
        pickup_lng: route.pickupLng,
        dropoff_address: dropoffAddress,
        dropoff_lat: route.dropoffLat,
        dropoff_lng: route.dropoffLng,
        distance_miles: route.distanceMiles,
        duration_minutes: route.durationMinutes,
        country_code: countryCode,
        currency: String(quoteObj.currency ?? "USD"),
        pricing_snapshot_id: quoteObj.pricing_id ?? null,
        subtotal_cents: quoteObj.subtotal_cents ?? 0,
        tax_cents: quoteObj.tax_cents ?? 0,
        platform_fee_cents: quoteObj.platform_fee_cents ?? 0,
        driver_payout_cents: quoteObj.driver_payout_cents ?? 0,
        total_cents: quoteObj.total_cents ?? 0,
        gross_total_cents: quoteObj.total_cents ?? 0,
        passenger_count: passengerCount,
        client_notes: clientNotes || null,
        payment_status: "unpaid",
        preferred_driver_id: preferredDriverId || null,
        is_scheduled: true,
        scheduled_pickup_at: new Date(pickupTime).toISOString(),
        stop_count: route.stops.length,
      })
      .select("*")
      .single();

    if (insertError || !ride) {
      return taxiJson(
        { ok: false, error: insertError?.message ?? "Failed to create ride" },
        500
      );
    }

    if (route.stops.length > 0) {
      const { error: stopsError } = await auth.supabaseAdmin
        .from("taxi_ride_stops")
        .insert(
          route.stops.map((stop) => ({
            taxi_ride_id: ride.id,
            stop_order: stop.stopOrder,
            address: stop.address,
            lat: stop.lat,
            lng: stop.lng,
          }))
        );

      if (stopsError) {
        return taxiJson({ ok: false, error: stopsError.message }, 500);
      }
    }

    const { data: scheduled, error: scheduledError } = await auth.supabaseAdmin
      .from("taxi_scheduled_rides")
      .insert({
        taxi_ride_id: ride.id,
        client_user_id: auth.user.id,
        scheduled_pickup_at: new Date(pickupTime).toISOString(),
      })
      .select("*")
      .single();

    if (scheduledError || !scheduled) {
      return taxiJson(
        { ok: false, error: scheduledError?.message ?? "Failed to schedule ride" },
        500
      );
    }

    if (promoCode) {
      const { data: promoData, error: promoError } = await auth.supabaseAdmin.rpc(
        "apply_taxi_promotion_to_ride",
        { p_ride_id: String(ride.id), p_code: promoCode }
      );
      if (promoError) {
        return taxiJson({ ok: false, error: promoError.message }, 500);
      }
      const promoObj = (promoData ?? {}) as Record<string, unknown>;
      if (promoObj.ok === false) {
        return taxiJson({ ok: false, ...promoObj }, 400);
      }
    }

    if (rewardId) {
      const { data: rewardData, error: rewardError } = await auth.supabaseAdmin.rpc(
        "apply_taxi_loyalty_reward_to_ride",
        {
          p_ride_id: String(ride.id),
          p_reward_id: rewardId,
          p_user_id: auth.user.id,
        }
      );
      if (rewardError) {
        return taxiJson({ ok: false, error: rewardError.message }, 500);
      }
      const rewardObj = (rewardData ?? {}) as Record<string, unknown>;
      if (rewardObj.ok === false) {
        return taxiJson({ ok: false, ...rewardObj }, 400);
      }
    }

    const { data: refreshedRide } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("*")
      .eq("id", ride.id)
      .maybeSingle();

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId: String(ride.id),
      eventType: "scheduled_ride_created",
      oldStatus: null,
      newStatus: "quoted",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client created scheduled taxi ride",
      metadata: { scheduled_pickup_at: scheduled.scheduled_pickup_at },
    });

    return taxiJson({
      ok: true,
      ride: refreshedRide ?? ride,
      scheduled,
      quote: quoteObj,
      route,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1),
      100
    );

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_scheduled_rides")
      .select(
        `
        *,
        taxi_rides:taxi_ride_id (
          id,
          status,
          payment_status,
          pickup_address,
          dropoff_address,
          total_cents,
          currency,
          scheduled_pickup_at,
          stop_count
        )
      `
      )
      .eq("client_user_id", auth.user.id)
      .neq("status", "canceled")
      .gte("scheduled_pickup_at", new Date().toISOString())
      .order("scheduled_pickup_at", { ascending: true })
      .limit(limit);

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, items: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
