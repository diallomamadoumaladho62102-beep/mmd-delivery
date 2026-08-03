/**
 * Stripe Checkout from a taxi quote — NO taxi_rides row until payment succeeds.
 * POST body matches /api/taxi/rides/create (minus creating the ride).
 */
import { NextRequest } from "next/server";
import { applyOwnedLocationIdsToTaxiInput } from "@/lib/mmdLocationSnapshot";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiCountryWithDetection } from "@/lib/taxiCountryDetection";
import { resolveTaxiPickupCity } from "@/lib/taxiCityDetection";
import { calculateTaxiFinalPriceSnapshot } from "@/lib/taxiFinalPrice";
import { resolveMmdPlusCheckoutBenefits } from "@/lib/mmdPlus/mmdPlusEngine";
import {
  applyTaxiServiceFeeToQuote,
  mergeTaxiServiceFeeIntoQuote,
} from "@/lib/taxiServiceFee";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { assertCanStartServiceFromOrigin } from "@/lib/originCountyServiceGate";
import { shouldApplyCountyCommercialOverride } from "@/lib/platformScopeFlags";
import type {
  TaxiAmbiancePreference,
  TaxiClientPreferences,
} from "@/lib/taxiClientPreferences";
import { validateRouteClaimsServer } from "@/lib/geoTrust";
import {
  buildRoundTripRouteInput,
  normalizeReturnScheduledAt,
  normalizeReturnWaitMinutes,
  normalizeTaxiReturnMode,
  normalizeTaxiTripMode,
} from "@/lib/taxiTripMode";
import { buildTaxiFareComponentsDoc } from "@/lib/taxi/taxiFareComponents";
import {
  createTaxiCheckoutIntent,
  openTaxiQuoteCheckoutSession,
  type TaxiCheckoutIntentSnapshot,
} from "@/lib/taxi/taxiCheckoutFromQuote";
import { selectRideChargePath } from "@/lib/pricingEngine/charge/selectRideChargePath";

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
  clientNotes?: string;
  client_notes?: string;
  expectedQuoteTotalCents?: number;
  expected_quote_total_cents?: number;
  preferredDriverId?: string;
  preferred_driver_id?: string;
  promoCode?: string;
  promo_code?: string;
  stops?: { address?: string; lat?: number; lng?: number }[];
  sharedRide?: boolean;
  shared_ride?: boolean;
  premiumDriverOnly?: boolean;
  premium_driver_only?: boolean;
  preferElectricOrHybrid?: boolean;
  prefer_electric_or_hybrid?: boolean;
  businessAccountId?: string;
  business_account_id?: string;
  businessTripType?: string;
  business_trip_type?: string;
  clientPreferences?: Partial<TaxiClientPreferences> & Record<string, unknown>;
  client_preferences?: Partial<TaxiClientPreferences> & Record<string, unknown>;
  ambiancePreference?: TaxiAmbiancePreference;
  ambiance_preference?: TaxiAmbiancePreference;
  tripMode?: string;
  trip_mode?: string;
  returnMode?: string;
  return_mode?: string;
  returnWaitMinutes?: number;
  return_wait_minutes?: number;
  returnScheduledAt?: string;
  return_scheduled_at?: string;
};

function parseClientPreferences(body: Body): {
  clientPreferences: Record<string, boolean>;
  ambiance: TaxiAmbiancePreference;
  preferElectricOrHybrid: boolean;
} {
  const raw = (body.clientPreferences ?? body.client_preferences ?? {}) as Record<
    string,
    unknown
  >;
  const ambiance = String(
    body.ambiancePreference ?? body.ambiance_preference ?? raw.ambiance ?? "none",
  ).trim() as TaxiAmbiancePreference;

  const clientPreferences: Record<string, boolean> = {
    non_smoking_driver: Boolean(raw.non_smoking_driver),
    child_seat_required: Boolean(raw.child_seat_required),
    pets_allowed: Boolean(raw.pets_allowed),
    large_luggage: Boolean(raw.large_luggage),
    air_conditioning_required: Boolean(raw.air_conditioning_required),
    phone_charger_requested: Boolean(raw.phone_charger_requested),
    prefer_quiet_vehicle: Boolean(raw.prefer_quiet_vehicle),
  };

  const preferElectricOrHybrid =
    body.preferElectricOrHybrid === true ||
    body.prefer_electric_or_hybrid === true ||
    Boolean(raw.prefer_electric_or_hybrid);

  return {
    clientPreferences,
    ambiance: ["quiet", "music", "conversation", "none"].includes(ambiance)
      ? ambiance
      : "none",
    preferElectricOrHybrid,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Body;
    const vehicleClass = String(
      body.vehicleClass ?? body.vehicle_class ?? "standard",
    ).trim();
    const passengerCount = Math.max(
      1,
      Number(body.passengerCount ?? body.passenger_count ?? 1),
    );
    const manualCountryCode = normalizeTaxiCountryCode(
      body.countryCode ?? body.country_code ?? "US",
    );
    const clientNotes = String(body.clientNotes ?? body.client_notes ?? "").trim();
    const preferredDriverId = String(
      body.preferredDriverId ?? body.preferred_driver_id ?? "",
    ).trim();
    const promoCode = String(body.promoCode ?? body.promo_code ?? "").trim();
    const sharedRide = body.sharedRide === true || body.shared_ride === true;
    const premiumDriverOnly =
      body.premiumDriverOnly === true || body.premium_driver_only === true;
    const parsedPrefs = parseClientPreferences(body);
    const preferElectricOrHybrid = parsedPrefs.preferElectricOrHybrid;
    const businessAccountId = String(
      body.businessAccountId ?? body.business_account_id ?? "",
    ).trim();
    const businessTripType = String(
      body.businessTripType ?? body.business_trip_type ?? "personal",
    ).trim();

    if (preferredDriverId) {
      const { data: favorite, error: favoriteError } = await auth.supabaseAdmin
        .from("taxi_client_favorite_drivers")
        .select("id")
        .eq("client_user_id", auth.user.id)
        .eq("driver_user_id", preferredDriverId)
        .maybeSingle();

      if (favoriteError) {
        return taxiJson({ ok: false, error: favoriteError.message }, 500);
      }
      if (!favorite?.id) {
        return taxiJson({ ok: false, error: "preferred_driver_not_favorited" }, 400);
      }
    }

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
      "active",
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
          403,
        );
      }
    }

    const launchConfig = await fetchTaxiCountryLaunchConfig(
      auth.supabaseAdmin,
      countryCode,
    );
    if (!launchConfig) {
      return taxiJson({ ok: false, error: "country_launch_config_missing" }, 400);
    }
    if (sharedRide) {
      const sharedCheck = assertTaxiLaunchFeature(launchConfig, "shared");
      if (sharedCheck.ok === false) {
        return taxiJson({ ok: false, ...sharedCheck }, 400);
      }
    }
    if (premiumDriverOnly) {
      const premiumCheck = assertTaxiLaunchFeature(launchConfig, "premium");
      if (premiumCheck.ok === false) {
        return taxiJson({ ok: false, ...premiumCheck }, 400);
      }
    }
    if (businessTripType === "business" && businessAccountId) {
      const businessCheck = assertTaxiLaunchFeature(launchConfig, "business");
      if (businessCheck.ok === false) {
        return taxiJson({ ok: false, ...businessCheck }, 400);
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
      },
    );
    if (quoteError) {
      return taxiJson({ ok: false, error: quoteError.message }, 500);
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
      serviceFeeQuote,
    );

    const expectedQuoteTotalCents = Math.round(
      Number(body.expectedQuoteTotalCents ?? body.expected_quote_total_cents ?? 0),
    );
    if (!Number.isFinite(expectedQuoteTotalCents) || expectedQuoteTotalCents <= 0) {
      return taxiJson(
        {
          ok: false,
          error: "expected_quote_required",
          message: "A current server quote is required before checkout.",
        },
        400,
      );
    }

    const quoteGrossCents = Math.round(Number(quoteWithServiceFee.total_cents ?? 0));

    const mmdPlusBenefits = await resolveMmdPlusCheckoutBenefits(auth.supabaseAdmin, {
      userId: auth.user.id,
      service: "taxi",
      subtotalCents: Math.round(Number(quoteWithServiceFee.subtotal_cents ?? 0)),
      deliveryFeeCents: 0,
    });
    const mmdPlusDiscountCents = Math.max(0, mmdPlusBenefits.order_discount_cents || 0);
    const pricedSnapshot = calculateTaxiFinalPriceSnapshot({
      subtotal_cents: Math.round(Number(quoteWithServiceFee.subtotal_cents ?? 0)),
      tax_cents: Math.round(Number(quoteWithServiceFee.tax_cents ?? 0)),
      gross_total_cents: Math.round(
        Number(
          quoteWithServiceFee.gross_total_cents ?? quoteWithServiceFee.total_cents ?? 0,
        ),
      ),
      mmd_plus_discount_cents: mmdPlusDiscountCents,
    });
    const pricedTotalCents = pricedSnapshot.total_cents;

    const rideSelection = await selectRideChargePath({
      capture: {
        currency: String(quoteWithServiceFee.currency ?? "USD"),
        subtotal_cents: Math.round(Number(quoteWithServiceFee.subtotal_cents ?? 0)),
        tax_cents: Math.round(Number(quoteWithServiceFee.tax_cents ?? 0)),
        service_fee_cents: Math.round(
          Number(quoteWithServiceFee.service_fee_cents ?? 0),
        ),
        platform_fee_cents: Math.round(
          Number(quoteWithServiceFee.platform_fee_cents ?? 0),
        ),
        driver_payout_cents: Math.round(
          Number(quoteWithServiceFee.driver_payout_cents ?? 0),
        ),
        shared_ride: sharedRide,
        shared_discount_cents: Math.round(
          Number(quoteWithServiceFee.shared_discount_cents ?? 0),
        ),
        promo_discount_cents: Math.round(
          Number(quoteWithServiceFee.promo_discount_cents ?? 0),
        ),
        loyalty_discount_cents: Math.round(
          Number(quoteWithServiceFee.loyalty_discount_cents ?? 0),
        ),
        mmd_credit_cents: Math.round(
          Number(quoteWithServiceFee.mmd_credit_cents ?? 0),
        ),
        mmd_plus_discount_cents: mmdPlusDiscountCents,
        total_cents: pricedTotalCents,
      },
      countryCode,
      canaryKey: auth.user.id,
      supabaseAdmin: auth.supabaseAdmin,
    });
    const netTotalCents = rideSelection.customerTotalCents;

    if (Math.abs(netTotalCents - expectedQuoteTotalCents) > 1) {
      return taxiJson(
        {
          ok: false,
          error: "quote_price_changed",
          expected_quote_total_cents: expectedQuoteTotalCents,
          current_total_cents: netTotalCents,
        },
        409,
      );
    }

    let pricingRow: Record<string, unknown> | null = null;
    const pricingId = String(quoteWithServiceFee.pricing_id ?? "").trim();
    if (pricingId) {
      const fullSelect =
        "id, base_fare, per_mile, per_minute, min_fare, booking_fee, class_multiplier, surge_multiplier, airport_fee, cleaning_fee";
      const legacySelect =
        "id, base_fare, per_mile, per_minute, min_fare, booking_fee, class_multiplier";
      const full = await auth.supabaseAdmin
        .from("taxi_pricing")
        .select(fullSelect)
        .eq("id", pricingId)
        .maybeSingle();
      if (full.error) {
        const legacy = await auth.supabaseAdmin
          .from("taxi_pricing")
          .select(legacySelect)
          .eq("id", pricingId)
          .maybeSingle();
        pricingRow = (legacy.data as Record<string, unknown> | null) ?? null;
      } else {
        pricingRow = (full.data as Record<string, unknown> | null) ?? null;
      }
    }

    const fareComponents = buildTaxiFareComponentsDoc({
      currency: String(quoteWithServiceFee.currency ?? "USD"),
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      pricing: pricingRow,
      ride: {
        ...quoteWithServiceFee,
        distance_miles: route.distanceMiles,
        duration_minutes: route.durationMinutes,
        mmd_plus_discount_cents: mmdPlusDiscountCents,
      },
    });

    let businessMemberId: string | null = null;
    let businessApprovalStatus = "not_required";
    if (businessTripType === "business" && businessAccountId) {
      const { data: businessCheck, error: businessError } =
        await auth.supabaseAdmin.rpc("validate_taxi_business_ride", {
          p_user_id: auth.user.id,
          p_business_account_id: businessAccountId,
          p_amount_cents: quoteGrossCents,
        });
      if (businessError) {
        return taxiJson({ ok: false, error: businessError.message }, 500);
      }
      const businessObj = (businessCheck ?? {}) as Record<string, unknown>;
      if (businessObj.ok === false) {
        return taxiJson({ ok: false, ...businessObj }, 400);
      }
      const { data: memberRow } = await auth.supabaseAdmin
        .from("taxi_business_members")
        .select("id")
        .eq("business_account_id", businessAccountId)
        .eq("user_id", auth.user.id)
        .eq("active", true)
        .maybeSingle();
      businessMemberId = memberRow?.id ? String(memberRow.id) : null;
      businessApprovalStatus =
        businessObj.requires_approval === true ? "pending" : "approved";
    }

    const pickupAddress =
      route.pickupAddress ||
      body.pickupAddress?.trim() ||
      `${route.pickupLat}, ${route.pickupLng}`;
    const dropoffAddress =
      route.dropoffAddress ||
      body.dropoffAddress?.trim() ||
      `${route.dropoffLat}, ${route.dropoffLng}`;

    const pickupCity = await resolveTaxiPickupCity({
      supabaseAdmin: auth.supabaseAdmin,
      pickupLocationId: locationInput.pickupLocationId,
      pickupLat: route.pickupLat,
      pickupLng: route.pickupLng,
      pickupAddress,
    });

    let electricSearchUntil: string | null = null;
    if (preferElectricOrHybrid) {
      const { data: electricSeconds } = await auth.supabaseAdmin.rpc(
        "resolve_electric_search_seconds",
        { p_country_code: countryCode, p_city: pickupCity },
      );
      const seconds = Number(electricSeconds ?? 30);
      electricSearchUntil = new Date(Date.now() + seconds * 1000).toISOString();
    }

    const snapshot: TaxiCheckoutIntentSnapshot = {
      version: 1,
      client_user_id: auth.user.id,
      country_code: countryCode,
      currency: String(quoteWithServiceFee.currency ?? "USD"),
      amount_cents: netTotalCents,
      vehicle_class: vehicleClass,
      passenger_count: passengerCount,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      pickup_lat: route.pickupLat,
      pickup_lng: route.pickupLng,
      dropoff_lat: route.dropoffLat,
      dropoff_lng: route.dropoffLng,
      pickup_location_id: locationInput.pickupLocationId,
      dropoff_location_id: locationInput.dropoffLocationId,
      pickup_city: pickupCity,
      distance_miles: route.distanceMiles,
      duration_minutes: route.durationMinutes,
      pricing_snapshot_id: String(quoteWithServiceFee.pricing_id ?? "") || null,
      subtotal_cents: Math.round(Number(quoteWithServiceFee.subtotal_cents ?? 0)),
      tax_cents: Math.round(Number(quoteWithServiceFee.tax_cents ?? 0)),
      platform_fee_cents: Math.round(Number(quoteWithServiceFee.platform_fee_cents ?? 0)),
      driver_payout_cents: Math.round(Number(quoteWithServiceFee.driver_payout_cents ?? 0)),
      service_fee_cents: Math.round(Number(quoteWithServiceFee.service_fee_cents ?? 0)),
      service_fee_pct: Number(quoteWithServiceFee.service_fee_pct ?? 0),
      service_fee_enabled: quoteWithServiceFee.service_fee_enabled === true,
      service_fee_fixed_cents: Math.round(
        Number(quoteWithServiceFee.service_fee_fixed_cents ?? 0),
      ),
      gross_total_cents: Math.round(
        Number(
          quoteWithServiceFee.gross_total_cents ?? quoteWithServiceFee.total_cents ?? 0,
        ),
      ),
      mmd_plus_discount_cents: mmdPlusDiscountCents,
      fare_components: fareComponents as unknown as Record<string, unknown>,
      stops: route.stops.map((stop) => ({
        stop_order: stop.stopOrder,
        address: stop.address,
        lat: stop.lat,
        lng: stop.lng,
      })),
      preferred_driver_id: preferredDriverId || null,
      premium_driver_only: premiumDriverOnly,
      prefer_electric_or_hybrid: preferElectricOrHybrid,
      electric_search_until: electricSearchUntil,
      client_preferences: parsedPrefs.clientPreferences,
      ambiance_preference: parsedPrefs.ambiance,
      client_notes: clientNotes || null,
      business_account_id:
        businessTripType === "business" && businessAccountId
          ? businessAccountId
          : null,
      business_member_id: businessMemberId,
      business_trip_type:
        businessTripType === "business" && businessAccountId
          ? "business"
          : "personal",
      business_approval_status: businessApprovalStatus,
      trip_mode: tripMode,
      return_mode: returnMode,
      return_wait_minutes: returnWaitMinutes,
      return_scheduled_at: returnScheduledAt,
      is_shared_ride: sharedRide,
      promo_code: promoCode || null,
      charge_path: rideSelection.chargePath,
      engine_quote_snapshot_id: rideSelection.snapshot?.snapshotId ?? null,
    };

    const intent = await createTaxiCheckoutIntent({
      supabaseAdmin: auth.supabaseAdmin,
      snapshot,
    });
    if (intent.ok === false) {
      return taxiJson({ ok: false, error: intent.error }, 500);
    }

    const checkout = await openTaxiQuoteCheckoutSession({
      supabaseAdmin: auth.supabaseAdmin,
      intentId: intent.intentId,
      userId: auth.user.id,
      userEmail: auth.user.email,
      snapshot,
    });
    if (checkout.ok === false) {
      return taxiJson(
        { ok: false, error: checkout.error },
        checkout.status ?? 500,
      );
    }

    return taxiJson({
      ok: true,
      pay_then_create: true,
      quote_checkout_id: intent.intentId,
      session_id: checkout.sessionId,
      url: checkout.url,
      amount_cents: netTotalCents,
      charge_path: rideSelection.chargePath,
      engine_quote_snapshot_id: rideSelection.snapshot?.snapshotId ?? null,
      currency: snapshot.currency,
      taxi_ride_id: null,
    });
  } catch (e: unknown) {
    console.error("[create-taxi-quote-checkout-session]", e);
    return taxiJson(
      {
        ok: false,
        error: e instanceof Error ? e.message : "checkout_failed",
      },
      500,
    );
  }
}
