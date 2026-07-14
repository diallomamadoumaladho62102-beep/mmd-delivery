import type { SupabaseClient } from "@supabase/supabase-js";
import { runDeliveryPricingV2Engine } from "@/lib/deliveryPricingEngine";
import { logDeliveryPricingV2Shadow } from "@/lib/deliveryPricingEngine/logShadow";
import { computeDeliveryPricing } from "@/lib/deliveryPricing";

export type MarketplaceDeliveryShadowStatus =
  | "not_started"
  | "quoted_shadow"
  | "dispatch_simulated"
  | "live_not_enabled";

export type MarketplaceDispatchShadow = {
  pickup_zone_code: string | null;
  dropoff_zone_code: string | null;
  pickup_country_code: string | null;
  dropoff_country_code: string | null;
  active_drivers_in_zone: number;
  recommended_dispatch_radius_miles: number;
  dispatch_readiness: "not_ready" | "shadow_ready" | "insufficient_drivers";
  live_dispatch_enabled: false;
  drivers_notified: false;
  message: string;
};

export type MarketplaceDeliveryQuoteShadow = {
  customer_delivery_total_cents: number;
  driver_estimated_earning_cents: number;
  platform_margin_cents: number;
  pricing_engine_version: "v2_shadow";
  estimated_distance_miles: number;
  estimated_minutes: number;
  pickup_location_id: string | null;
  dropoff_location_id: string | null;
  seller_pickup_address: string | null;
};

export type MarketplaceDeliveryShadowResult = {
  delivery_status_shadow: MarketplaceDeliveryShadowStatus;
  delivery_quote_shadow: MarketplaceDeliveryQuoteShadow;
  estimated_distance_miles: number;
  estimated_minutes: number;
  driver_earning_shadow_cents: number;
  platform_margin_shadow_cents: number;
  dispatch_shadow: MarketplaceDispatchShadow;
};

export function isMarketplaceDeliveryShadowEnabled(): boolean {
  return process.env.MARKETPLACE_DELIVERY_SHADOW_ENABLED === "true";
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateMinutesFromMiles(distanceMiles: number): number {
  return Math.max(5, Math.round((distanceMiles / 18) * 60));
}

export function computeMarketplaceDispatchShadow(input: {
  pickupZoneCode?: string | null;
  dropoffZoneCode?: string | null;
  pickupCountryCode?: string | null;
  dropoffCountryCode?: string | null;
  activeDriversInZone: number;
  estimatedDistanceMiles: number;
}): MarketplaceDispatchShadow {
  const activeDrivers = Math.max(0, Math.round(input.activeDriversInZone));
  const radiusBase = Math.max(2, Math.min(12, input.estimatedDistanceMiles * 1.25));
  const recommendedRadius =
    activeDrivers >= 5 ? radiusBase : Math.min(18, radiusBase + 4);

  let dispatchReadiness: MarketplaceDispatchShadow["dispatch_readiness"] =
    "not_ready";
  let message = "Marketplace delivery dispatch is not live yet.";

  if (activeDrivers <= 0) {
    dispatchReadiness = "insufficient_drivers";
    message = "Shadow dispatch simulated with zero online drivers in zone.";
  } else if (input.estimatedDistanceMiles > 0) {
    dispatchReadiness = "shadow_ready";
    message =
      "Shadow dispatch simulated only — no drivers notified, no live delivery_requests.";
  }

  return {
    pickup_zone_code: input.pickupZoneCode ?? null,
    dropoff_zone_code: input.dropoffZoneCode ?? null,
    pickup_country_code: input.pickupCountryCode ?? null,
    dropoff_country_code: input.dropoffCountryCode ?? null,
    active_drivers_in_zone: activeDrivers,
    recommended_dispatch_radius_miles: Math.round(recommendedRadius * 100) / 100,
    dispatch_readiness: dispatchReadiness,
    live_dispatch_enabled: false,
    drivers_notified: false,
    message,
  };
}

export function computeMarketplaceDeliveryShadow(input: {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
  sellerPickupAddress?: string | null;
  pickupZoneCode?: string | null;
  dropoffZoneCode?: string | null;
  pickupCountryCode?: string | null;
  dropoffCountryCode?: string | null;
  activeDriversInZone?: number;
  demandLevel?: number;
}): MarketplaceDeliveryShadowResult {
  const hasCoords =
    input.pickupLat != null &&
    input.pickupLng != null &&
    input.dropoffLat != null &&
    input.dropoffLng != null;

  const estimatedDistanceMiles = hasCoords
    ? Math.round(haversineMiles(input.pickupLat!, input.pickupLng!, input.dropoffLat!, input.dropoffLng!) * 100) / 100
    : 3.5;
  const estimatedMinutes = estimateMinutesFromMiles(estimatedDistanceMiles);

  const v2 = runDeliveryPricingV2Engine({
    distanceMiles: estimatedDistanceMiles,
    durationMinutes: estimatedMinutes,
    driver: {
      demandLevel: input.demandLevel ?? 0.2,
      activeDriversInZone: input.activeDriversInZone ?? 1,
      pickupDistanceMiles: Math.min(estimatedDistanceMiles * 0.2, 2),
    },
  });

  const deliveryQuote: MarketplaceDeliveryQuoteShadow = {
    customer_delivery_total_cents: v2.customer.totalCents,
    driver_estimated_earning_cents: v2.driver.earningCents,
    platform_margin_cents: v2.platform.marginCents,
    pricing_engine_version: "v2_shadow",
    estimated_distance_miles: estimatedDistanceMiles,
    estimated_minutes: estimatedMinutes,
    pickup_location_id: input.pickupLocationId ?? null,
    dropoff_location_id: input.dropoffLocationId ?? null,
    seller_pickup_address: input.sellerPickupAddress ?? null,
  };

  const dispatchShadow = computeMarketplaceDispatchShadow({
    pickupZoneCode: input.pickupZoneCode,
    dropoffZoneCode: input.dropoffZoneCode,
    pickupCountryCode: input.pickupCountryCode,
    dropoffCountryCode: input.dropoffCountryCode,
    activeDriversInZone: input.activeDriversInZone ?? 0,
    estimatedDistanceMiles,
  });

  return {
    delivery_status_shadow: "dispatch_simulated",
    delivery_quote_shadow: deliveryQuote,
    estimated_distance_miles: estimatedDistanceMiles,
    estimated_minutes: estimatedMinutes,
    driver_earning_shadow_cents: v2.driver.earningCents,
    platform_margin_shadow_cents: v2.platform.marginCents,
    dispatch_shadow: dispatchShadow,
  };
}

async function loadLocationPoint(
  supabaseAdmin: SupabaseClient,
  locationId?: string | null
) {
  if (!locationId) return null;
  const { data, error } = await supabaseAdmin
    .from("location_points")
    .select("id,pin_lat,pin_lng,country_code,commune_name,quartier_name")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function countOnlineDriversInCountry(
  supabaseAdmin: SupabaseClient,
  countryCode?: string | null
): Promise<number> {
  let query = supabaseAdmin
    .from("driver_profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_online", true)
    .eq("status", "approved");

  if (countryCode) {
    // driver_profiles uses state/city; country is approximated via city/state null-safe skip
    // Shadow-only heuristic: count all approved online drivers when country unknown.
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function buildMarketplaceDeliveryShadowForOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    sellerId: string;
    pickupLocationId?: string | null;
    dropoffLocationId?: string | null;
    countryCode?: string | null;
  }
): Promise<MarketplaceDeliveryShadowResult> {
  const [{ data: seller, error: sellerError }, pickupPoint, dropoffPoint, activeDrivers] =
    await Promise.all([
      supabaseAdmin
        .from("sellers")
        .select("id,address,city,country_code,region_code,mmd_zone_id")
        .eq("id", params.sellerId)
        .maybeSingle(),
      loadLocationPoint(supabaseAdmin, params.pickupLocationId),
      loadLocationPoint(supabaseAdmin, params.dropoffLocationId),
      countOnlineDriversInCountry(supabaseAdmin, params.countryCode),
    ]);

  if (sellerError) throw new Error(sellerError.message);
  if (!seller) throw new Error("Seller not found");

  const sellerPickupAddress = [seller.address, seller.city, seller.country_code]
    .filter(Boolean)
    .join(", ");

  return computeMarketplaceDeliveryShadow({
    pickupLat: pickupPoint?.pin_lat,
    pickupLng: pickupPoint?.pin_lng,
    dropoffLat: dropoffPoint?.pin_lat,
    dropoffLng: dropoffPoint?.pin_lng,
    pickupLocationId: pickupPoint?.id ?? params.pickupLocationId ?? null,
    dropoffLocationId: dropoffPoint?.id ?? params.dropoffLocationId ?? null,
    sellerPickupAddress,
    pickupZoneCode: seller.region_code ?? pickupPoint?.quartier_name ?? null,
    dropoffZoneCode: dropoffPoint?.quartier_name ?? dropoffPoint?.commune_name ?? null,
    pickupCountryCode: seller.country_code ?? pickupPoint?.country_code ?? params.countryCode ?? null,
    dropoffCountryCode: dropoffPoint?.country_code ?? params.countryCode ?? null,
    activeDriversInZone: activeDrivers,
  });
}

export async function persistMarketplaceDeliveryShadow(
  supabaseAdmin: SupabaseClient,
  params: {
    orderId: string;
    sellerId: string;
    pickupLocationId?: string | null;
    dropoffLocationId?: string | null;
    countryCode?: string | null;
  }
): Promise<MarketplaceDeliveryShadowResult | null> {
  if (!isMarketplaceDeliveryShadowEnabled()) {
    return null;
  }

  try {
    const shadow = await buildMarketplaceDeliveryShadowForOrder(supabaseAdmin, params);

    const { error } = await supabaseAdmin
      .from("seller_orders")
      .update({
        pickup_location_id: shadow.delivery_quote_shadow.pickup_location_id,
        dropoff_location_id: shadow.delivery_quote_shadow.dropoff_location_id,
        seller_pickup_address: shadow.delivery_quote_shadow.seller_pickup_address,
        delivery_status_shadow: shadow.delivery_status_shadow,
        delivery_quote_shadow: shadow.delivery_quote_shadow,
        estimated_distance_miles: shadow.estimated_distance_miles,
        estimated_minutes: shadow.estimated_minutes,
        driver_earning_shadow_cents: shadow.driver_earning_shadow_cents,
        platform_margin_shadow_cents: shadow.platform_margin_shadow_cents,
        dispatch_shadow: shadow.dispatch_shadow,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.orderId);

    if (error) throw new Error(error.message);

    void logDeliveryPricingV2Shadow({
      sourceType: "marketplace_order_future",
      sourceId: params.orderId,
      countryCode: params.countryCode ?? null,
      distanceMiles: shadow.estimated_distance_miles,
      durationMinutes: shadow.estimated_minutes,
      // Shadow compare only — no Admin pricing_config row here. Pass the
      // engine default pair explicitly so we never silently mix partial shares.
      v1Pricing: computeDeliveryPricing(
        {
          distanceMiles: shadow.estimated_distance_miles,
          durationMinutes: shadow.estimated_minutes,
        },
        { driverSharePct: 80, platformSharePct: 20 }
      ),
      inputs: {
        path: "marketplaceDeliveryShadow",
        seller_id: params.sellerId,
        pickup_location_id: params.pickupLocationId ?? null,
        dropoff_location_id: params.dropoffLocationId ?? null,
        dispatch_shadow: shadow.dispatch_shadow,
        delivery_quote_shadow: shadow.delivery_quote_shadow,
      },
    }).catch(() => undefined);

    return shadow;
  } catch (error) {
    console.warn(
      "[marketplace-delivery-shadow] persist failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
