import { NextRequest } from "next/server";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { applyOwnedLocationIdsToTaxiInput } from "@/lib/mmdLocationSnapshot";
import { resolveTaxiMultiStopRoute } from "@/lib/taxiMapbox";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeTaxiCountryCode } from "@/lib/taxiCountries";
import { resolveTaxiCountryWithDetection } from "@/lib/taxiCountryDetection";
import {
  assertTaxiQuotePriceMatches,
  snapshotFromQuoteRpc,
  snapshotFromRideRow,
} from "@/lib/taxiFinalPrice";
import {
  applyTaxiServiceFeeToQuote,
  mergeTaxiServiceFeeIntoQuote,
} from "@/lib/taxiServiceFee";
import {
  assertTaxiLaunchFeature,
  fetchTaxiCountryLaunchConfig,
} from "@/lib/taxiLaunchControl";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";

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
  rewardId?: string;
  reward_id?: string;
  stops?: { address?: string; lat?: number; lng?: number }[];
  sharedRide?: boolean;
  shared_ride?: boolean;
  premiumDriverOnly?: boolean;
  premium_driver_only?: boolean;
  businessAccountId?: string;
  business_account_id?: string;
  businessTripType?: string;
  business_trip_type?: string;
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
    const clientNotes = String(
      body.clientNotes ?? body.client_notes ?? ""
    ).trim();
    const preferredDriverId = String(
      body.preferredDriverId ?? body.preferred_driver_id ?? ""
    ).trim();
    const promoCode = String(body.promoCode ?? body.promo_code ?? "").trim();
    const rewardId = String(body.rewardId ?? body.reward_id ?? "").trim();
    const sharedRide =
      body.sharedRide === true || body.shared_ride === true;
    const premiumDriverOnly =
      body.premiumDriverOnly === true || body.premium_driver_only === true;
    const businessAccountId = String(
      body.businessAccountId ?? body.business_account_id ?? ""
    ).trim();
    const businessTripType = String(
      body.businessTripType ?? body.business_trip_type ?? "personal"
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
      }
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
      serviceFeeQuote
    );

    const expectedQuoteTotalCents = Math.round(
      Number(
        body.expectedQuoteTotalCents ?? body.expected_quote_total_cents ?? 0
      )
    );
    const quoteGrossCents = Math.round(Number(quoteWithServiceFee.total_cents ?? 0));

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

    const { data: ride, error: insertError } = await auth.supabaseAdmin
      .from("taxi_rides")
      .insert({
        client_user_id: auth.user.id,
        vehicle_class: vehicleClass,
        status: "quoted",
        pickup_address: pickupAddress,
        pickup_lat: route.pickupLat,
        pickup_lng: route.pickupLng,
        pickup_location_id: locationInput.pickupLocationId,
        dropoff_address: dropoffAddress,
        dropoff_lat: route.dropoffLat,
        dropoff_lng: route.dropoffLng,
        dropoff_location_id: locationInput.dropoffLocationId,
        distance_miles: route.distanceMiles,
        duration_minutes: route.durationMinutes,
        country_code: countryCode,
        currency: String(quoteWithServiceFee.currency ?? "USD"),
        pricing_snapshot_id: quoteWithServiceFee.pricing_id ?? null,
        subtotal_cents: quoteWithServiceFee.subtotal_cents ?? 0,
        tax_cents: quoteWithServiceFee.tax_cents ?? 0,
        platform_fee_cents: quoteWithServiceFee.platform_fee_cents ?? 0,
        driver_payout_cents: quoteWithServiceFee.driver_payout_cents ?? 0,
        service_fee_cents: quoteWithServiceFee.service_fee_cents ?? 0,
        service_fee_pct: quoteWithServiceFee.service_fee_pct ?? 0,
        service_fee_enabled: quoteWithServiceFee.service_fee_enabled === true,
        service_fee_fixed_cents: quoteWithServiceFee.service_fee_fixed_cents ?? 0,
        total_cents: quoteWithServiceFee.total_cents ?? 0,
        gross_total_cents: quoteWithServiceFee.gross_total_cents ?? 0,
        passenger_count: passengerCount,
        client_notes: clientNotes || null,
        payment_status: "unpaid",
        preferred_driver_id: preferredDriverId || null,
        stop_count: route.stops.length,
        premium_driver_only: premiumDriverOnly,
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

    let promotionResult: Record<string, unknown> | null = null;
    if (promoCode) {
      const { data: promoData, error: promoError } = await auth.supabaseAdmin.rpc(
        "apply_taxi_promotion_to_ride",
        {
          p_ride_id: String(ride.id),
          p_code: promoCode,
        }
      );

      if (promoError) {
        return taxiJson({ ok: false, error: promoError.message }, 500);
      }

      const promoObj = (promoData ?? {}) as Record<string, unknown>;
      if (promoObj.ok === false) {
        return taxiJson({ ok: false, ...promoObj }, 400);
      }

      promotionResult = promoObj;
    }

    let rewardResult: Record<string, unknown> | null = null;
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

      rewardResult = rewardObj;
    }

    let sharedRideResult: Record<string, unknown> | null = null;
    if (sharedRide) {
      const { data: sharedData, error: sharedError } =
        await auth.supabaseAdmin.rpc("create_or_join_taxi_shared_ride", {
          p_ride_id: String(ride.id),
        });

      if (sharedError) {
        return taxiJson({ ok: false, error: sharedError.message }, 500);
      }

      sharedRideResult = (sharedData ?? {}) as Record<string, unknown>;
      if (sharedRideResult.ok === false) {
        return taxiJson({ ok: false, ...sharedRideResult }, 400);
      }

      await logTaxiEventServer(auth.supabaseAdmin, {
        rideId: String(ride.id),
        eventType: "shared_ride_matched",
        oldStatus: "quoted",
        newStatus: "quoted",
        actorId: auth.user.id,
        triggeredRole: "client",
        description: sharedRideResult.joined
          ? "Client joined shared ride group"
          : "Client created shared ride group",
        metadata: sharedRideResult,
      });

      const { data: refreshedRide } = await auth.supabaseAdmin
        .from("taxi_rides")
        .select("*")
        .eq("id", ride.id)
        .maybeSingle();

      if (refreshedRide) {
        Object.assign(ride, refreshedRide);
      }
    }

    if (
      businessTripType === "business" &&
      businessAccountId &&
      businessApprovalStatus === "approved"
    ) {
      await auth.supabaseAdmin.rpc("record_taxi_business_billing_event", {
        p_business_account_id: businessAccountId,
        p_taxi_ride_id: String(ride.id),
        p_member_user_id: auth.user.id,
        p_amount_cents: Number(ride.total_cents ?? quoteGrossCents),
        p_event_type: "ride_authorized",
        p_metadata: { source: "ride_create" },
      });
    }

    if (promoCode || rewardId) {
      const { data: refreshedRide } = await auth.supabaseAdmin
        .from("taxi_rides")
        .select("*")
        .eq("id", ride.id)
        .maybeSingle();

      if (refreshedRide) {
        Object.assign(ride, refreshedRide);
      }
    }

    const finalPrice = snapshotFromRideRow(ride);
    const driftCheck = assertTaxiQuotePriceMatches(
      expectedQuoteTotalCents,
      finalPrice
    );
    if (driftCheck.ok === false) {
      return taxiJson(
        {
          ok: false,
          error: driftCheck.error,
          expected_total_cents: driftCheck.expected_total_cents,
          actual_total_cents: driftCheck.actual_total_cents,
          price_snapshot: finalPrice,
          message:
            "The quoted price changed before booking. Please review the updated estimate.",
        },
        409
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

    return taxiJson({
      ok: true,
      ride,
      quote: quoteObj,
      price_snapshot: finalPrice,
      promotion: promotionResult,
      reward: rewardResult,
      shared_ride: sharedRideResult,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
