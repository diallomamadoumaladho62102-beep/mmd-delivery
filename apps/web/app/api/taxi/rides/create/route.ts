import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { resolveTaxiRoute } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  expectedQuoteTotalCents?: number;
  expected_quote_total_cents?: number;
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
    const vehicleClass = String(
      body.vehicleClass ?? body.vehicle_class ?? "standard"
    ).trim();
    const passengerCount = Math.max(
      1,
      Number(body.passengerCount ?? body.passenger_count ?? 1)
    );
    const countryCode = String(
      body.countryCode ?? body.country_code ?? "US"
    ).trim();
    const clientNotes = String(
      body.clientNotes ?? body.client_notes ?? ""
    ).trim();

    let route;
    try {
      route = await resolveTaxiRoute(body);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Route resolution failed";
      if (message === "distance_too_far") {
        return taxiJson({ ok: false, error: "distance_too_far" }, 400);
      }
      return taxiJson({ ok: false, error: message }, 400);
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

    const expectedQuoteTotalCents = Math.round(
      Number(
        body.expectedQuoteTotalCents ?? body.expected_quote_total_cents ?? 0
      )
    );
    const actualTotalCents = Math.round(Number(quoteObj.total_cents ?? 0));

    if (
      expectedQuoteTotalCents > 0 &&
      !isQuotePriceWithinTolerance(expectedQuoteTotalCents, actualTotalCents)
    ) {
      return taxiJson(
        {
          ok: false,
          error: "quote_price_drift",
          expected_total_cents: expectedQuoteTotalCents,
          actual_total_cents: actualTotalCents,
          message:
            "The quoted price changed before booking. Please review the updated estimate.",
        },
        409
      );
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
        platform_fee_cents: quoteObj.platform_fee_cents ?? 0,
        driver_payout_cents: quoteObj.driver_payout_cents ?? 0,
        total_cents: quoteObj.total_cents ?? 0,
        passenger_count: passengerCount,
        client_notes: clientNotes || null,
        payment_status: "unpaid",
      })
      .select("*")
      .single();

    if (insertError || !ride) {
      return taxiJson(
        { ok: false, error: insertError?.message ?? "Failed to create ride" },
        500
      );
    }

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId: String(ride.id),
      eventType: "ride_created",
      oldStatus: null,
      newStatus: "quoted",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Client created taxi ride",
      metadata: { quote: quoteObj },
    });

    await logTaxiEventServer(auth.supabaseAdmin, {
      rideId: String(ride.id),
      eventType: "ride_quoted",
      oldStatus: null,
      newStatus: "quoted",
      actorId: auth.user.id,
      triggeredRole: "client",
      description: "Taxi ride quoted",
      metadata: { quote: quoteObj },
    });

    return taxiJson({ ok: true, ride, quote: quoteObj });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
