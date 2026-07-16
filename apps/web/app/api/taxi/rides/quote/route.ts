import { NextRequest } from "next/server";
import { applyOwnedLocationIdsToTaxiInput } from "@/lib/mmdLocationSnapshot";
import { resolveTaxiMultiStopRoute, ROUTE_UNAVAILABLE } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiCountryWithDetection } from "@/lib/taxiCountryDetection";
import { applyTaxiServiceFeeToQuote, mergeTaxiServiceFeeIntoQuote } from "@/lib/taxiServiceFee";
import { snapshotFromQuoteRpc } from "@/lib/taxiFinalPrice";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { assertCanStartServiceFromOrigin } from "@/lib/originCountyServiceGate";
import { shouldApplyCountyCommercialOverride } from "@/lib/platformScopeFlags";
import { validateRouteClaimsServer } from "@/lib/geoTrust";
import {
  buildRoundTripRouteInput,
  normalizeReturnScheduledAt,
  normalizeReturnWaitMinutes,
  normalizeTaxiReturnMode,
  normalizeTaxiTripMode,
} from "@/lib/taxiTripMode";
import { resolveTaxiAddressConfig } from "@/lib/taxiAddressConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLocationId?: string;
  dropoffLocationId?: string;
  pickup_location_id?: string;
  dropoff_location_id?: string;
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
  stops?: { address?: string; lat?: number; lng?: number }[];
  sharedRide?: boolean;
  shared_ride?: boolean;
  tripMode?: string;
  trip_mode?: string;
  returnMode?: string;
  return_mode?: string;
  returnWaitMinutes?: number;
  return_wait_minutes?: number;
  returnScheduledAt?: string;
  return_scheduled_at?: string;
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Body;
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

    const locationInput = await applyOwnedLocationIdsToTaxiInput({
      supabaseAdmin: auth.supabaseAdmin,
      userId: auth.user.id,
      pickupLocationId: body.pickupLocationId ?? body.pickup_location_id,
      dropoffLocationId: body.dropoffLocationId ?? body.dropoff_location_id,
      pickupAddress: body.pickupAddress,
      dropoffAddress: body.dropoffAddress,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
    });

    if (locationInput.ok === false) {
      return taxiJson({ ok: false, error: locationInput.error }, locationInput.status);
    }

    const tripMode = normalizeTaxiTripMode(body.tripMode ?? body.trip_mode);
    const returnMode = normalizeTaxiReturnMode(
      tripMode,
      body.returnMode ?? body.return_mode,
    );
    const returnWaitMinutes = normalizeReturnWaitMinutes(
      returnMode,
      body.returnWaitMinutes ?? body.return_wait_minutes,
    );
    const returnScheduledAt = normalizeReturnScheduledAt(
      returnMode,
      body.returnScheduledAt ?? body.return_scheduled_at,
    );

    if (returnMode === "scheduled" && !returnScheduledAt) {
      return taxiJson({ ok: false, error: "return_scheduled_at_required" }, 400);
    }

    let route;
    try {
      route = await resolveTaxiMultiStopRoute(
        buildRoundTripRouteInput(
          {
            pickupAddress: locationInput.pickupAddress,
            dropoffAddress: locationInput.dropoffAddress,
            pickupLat: locationInput.pickupLat,
            pickupLng: locationInput.pickupLng,
            dropoffLat: locationInput.dropoffLat,
            dropoffLng: locationInput.dropoffLng,
            stops: body.stops,
          },
          tripMode,
        ),
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : ROUTE_UNAVAILABLE;
      if (message === "distance_too_far") {
        return taxiJson(
          {
            ok: false,
            error: "distance_too_far",
            message: toUserFacingError({ error: "distance_too_far" }, "La distance est trop importante pour cette course."),
          },
          400,
        );
      }
      logTechnicalError("taxi.quote.route", e, { userId: auth.user.id });
      return taxiJson(
        {
          ok: false,
          error: ROUTE_UNAVAILABLE,
          message: toUserFacingError(
            { error: ROUTE_UNAVAILABLE },
            "Nous n'avons pas pu calculer l'itinéraire exact pour le moment. Veuillez vérifier les adresses ou réessayer.",
          ),
        },
        400,
      );
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

    await validateRouteClaimsServer({
      pickup: {
        address: route.pickupAddress ?? locationInput.pickupAddress,
        lat: route.pickupLat,
        lng: route.pickupLng,
        claimedCountryCode: countryCode,
      },
      dropoff: {
        address: route.dropoffAddress ?? locationInput.dropoffAddress,
        lat: route.dropoffLat,
        lng: route.dropoffLng,
        claimedCountryCode: countryCode,
      },
      stops: route.stops.map((stop) => ({
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
        claimedCountryCode: countryCode,
      })),
      serverDistanceMiles: route.distanceMiles,
    });

    const platformCheck = await assertPlatformFeature(
      auth.supabaseAdmin,
      countryCode,
      "taxi",
      "active"
    );
    if (platformCheck.ok === false) {
      return taxiJson({ ok: false, ...platformCheck }, 403);
    }

    if (shouldApplyCountyCommercialOverride(countryCode)) {
      const originGate = await assertCanStartServiceFromOrigin(auth.supabaseAdmin, {
        service: "taxi",
        origin: {
          countryCode,
          lat: route.pickupLat,
          lng: route.pickupLng,
        },
        destination: {
          countryCode,
          lat: route.dropoffLat,
          lng: route.dropoffLng,
        },
      });
      if (!originGate.allowed) {
        return taxiJson(
          {
            ok: false,
            error: "taxi_unavailable",
            code: originGate.code,
            title: originGate.title,
            message: originGate.message,
            actions: originGate.actions,
          },
          403
        );
      }
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
      logTechnicalError("taxi.quote.rpc", quoteError, { userId: auth.user.id });
      return taxiJson(
        {
          ok: false,
          error: "quote_failed",
          message: toUserFacingError(quoteError, "Impossible d'estimer le tarif pour le moment. Réessayez dans quelques instants."),
        },
        500,
      );
    }

    const quoteObj = (quote ?? {}) as Record<string, unknown>;
    if (quoteObj.ok === false) {
      return taxiJson({ ok: false, ...quoteObj }, 400);
    }

    const serviceFeeQuote = await applyTaxiServiceFeeToQuote(auth.supabaseAdmin, {
      countryCode,
      vehicleClass,
      subtotalCents: Number(quoteObj.subtotal_cents ?? 0),
      taxCents: Number(quoteObj.tax_cents ?? 0),
    });
    const quoteWithServiceFee = mergeTaxiServiceFeeIntoQuote(
      quoteObj,
      serviceFeeQuote
    );

    const sharedRide =
      body.sharedRide === true || body.shared_ride === true;
    const priceSnapshot = snapshotFromQuoteRpc(quoteWithServiceFee, {
      shared_ride: sharedRide,
    });

    const { data: countryRow } = await auth.supabaseAdmin
      .from("taxi_countries")
      .select("metadata")
      .eq("country_code", countryCode)
      .maybeSingle();

    const addressConfig = resolveTaxiAddressConfig(countryCode, countryRow?.metadata);

    return taxiJson({
      ok: true,
      country_resolution: countryResult.resolution,
      address_config: addressConfig,
      trip_mode: tripMode,
      return_mode: returnMode,
      return_wait_minutes: returnWaitMinutes,
      return_scheduled_at: returnScheduledAt,
      quote: {
        ...quoteWithServiceFee,
        ...priceSnapshot,
        shared_ride: sharedRide,
        shared_discount_percent: priceSnapshot.shared_discount_cents > 0 ? 15 : 0,
      },
      route: {
        pickupLat: route.pickupLat,
        pickupLng: route.pickupLng,
        dropoffLat: route.dropoffLat,
        dropoffLng: route.dropoffLng,
        pickupAddress: route.pickupAddress,
        dropoffAddress: route.dropoffAddress,
        distanceMiles: route.distanceMiles,
        durationMinutes: route.durationMinutes,
        stops: route.stops,
      },
    });
  } catch (e: unknown) {
    logTechnicalError("taxi.quote", e);
    return taxiJson(
      {
        ok: false,
        error: "quote_failed",
        message: toUserFacingError(e, "Impossible d'estimer le tarif pour le moment. Réessayez dans quelques instants."),
      },
      500,
    );
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
