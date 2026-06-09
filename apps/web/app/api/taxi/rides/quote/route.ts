import { NextRequest } from "next/server";
import { applyOwnedLocationIdsToTaxiInput } from "@/lib/mmdLocationSnapshot";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiCountryWithDetection } from "@/lib/taxiCountryDetection";
import { snapshotFromQuoteRpc } from "@/lib/taxiFinalPrice";

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

    let route;
    try {
      route = await resolveTaxiMultiStopRoute({
        pickupAddress: locationInput.pickupAddress,
        dropoffAddress: locationInput.dropoffAddress,
        pickupLat: locationInput.pickupLat,
        pickupLng: locationInput.pickupLng,
        dropoffLat: locationInput.dropoffLat,
        dropoffLng: locationInput.dropoffLng,
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

    const sharedRide =
      body.sharedRide === true || body.shared_ride === true;
    const priceSnapshot = snapshotFromQuoteRpc(quoteObj, { shared_ride: sharedRide });

    return taxiJson({
      ok: true,
      country_resolution: countryResult.resolution,
      quote: {
        ...quoteObj,
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
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
