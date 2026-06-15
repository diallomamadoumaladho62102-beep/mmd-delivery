import type { NextRequest } from "next/server";
import {
  assertNoClientFoodPricingFields,
  type FoodOrderLineInput,
} from "@/lib/foodOrderServerPricing";

export type FoodOrderRequestBody = {
  restaurant_id?: string;
  restaurant_user_id?: string;
  restaurant_name?: string;
  pickup_address?: string;
  dropoff_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  items?: FoodOrderLineInput[];
  promo_code?: string | null;
};

export function parseFoodOrderRequestBody(body: Record<string, unknown>): FoodOrderRequestBody {
  assertNoClientFoodPricingFields(body);
  return body as FoodOrderRequestBody;
}

export function readFoodOrderBodyFields(body: FoodOrderRequestBody) {
  const restaurantUserId = String(
    body.restaurant_user_id ?? body.restaurant_id ?? ""
  ).trim();
  const restaurantName = String(body.restaurant_name ?? "").trim();
  const pickupAddress = String(body.pickup_address ?? "").trim();
  const dropoffAddress = String(body.dropoff_address ?? "").trim();
  const pickupLat = Number(body.pickup_lat);
  const pickupLng = Number(body.pickup_lng);
  const dropoffLat = Number(body.dropoff_lat);
  const dropoffLng = Number(body.dropoff_lng);
  const items = Array.isArray(body.items) ? body.items : [];
  const promoCode = body.promo_code ?? null;

  return {
    restaurantUserId,
    restaurantName,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    items,
    promoCode,
  };
}

export function validateFoodOrderBodyFields(fields: ReturnType<typeof readFoodOrderBodyFields>) {
  if (!fields.restaurantUserId) {
    throw new Error("Missing restaurant_id");
  }
  if (!fields.pickupAddress || !fields.dropoffAddress) {
    throw new Error("Missing pickup_address or dropoff_address");
  }
  if (
    !Number.isFinite(fields.pickupLat) ||
    !Number.isFinite(fields.pickupLng) ||
    !Number.isFinite(fields.dropoffLat) ||
    !Number.isFinite(fields.dropoffLng)
  ) {
    throw new Error("Missing or invalid coordinates");
  }
  if (!Array.isArray(fields.items) || fields.items.length === 0) {
    throw new Error("Cart is empty");
  }
}

export function countryCodeFromFoodAuthScope(scope: {
  country_code?: string | null;
}): string {
  return String(scope.country_code ?? "US").trim().toUpperCase() || "US";
}

export function buildFoodPricingResponse(pricing: Awaited<
  ReturnType<typeof import("@/lib/foodOrderServerPricing").computeFoodOrderPricing>
>) {
  return {
    country_code: pricing.countryCode,
    currency: pricing.currency,
    config_key: pricing.configKey,
    subtotal: pricing.subtotal,
    tax: pricing.tax,
    tax_rate_pct: pricing.taxRatePct,
    tax_source: pricing.taxSource,
    service_fee: pricing.serviceFee,
    service_fee_pct: pricing.serviceFeePct,
    delivery_fee: pricing.deliveryFee,
    delivery_fee_raw: pricing.deliveryFeeRaw,
    delivery_discount_amount: pricing.deliveryDiscountAmount,
    promo_code_applied: pricing.promoCodeApplied,
    promo_discount_amount: pricing.promoDiscountAmount,
    discounts: pricing.discounts,
    subtotal_after_discount: pricing.subtotalAfterDiscount,
    total: pricing.total,
    total_cents: pricing.totalCents,
    distance_miles: pricing.distanceMiles,
    eta_minutes: pricing.etaMinutes,
    driver_payout_estimate: pricing.driverPayoutEstimate,
    items: pricing.items,
  };
}

export type FoodOrderScopeQuery = {
  country?: string | null;
  lat?: number;
  lng?: number;
};

export function readFoodOrderScopeFromRequest(req: NextRequest): FoodOrderScopeQuery {
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  return {
    country: url.searchParams.get("country"),
    lat: latRaw != null && latRaw !== "" ? Number(latRaw) : undefined,
    lng: lngRaw != null && lngRaw !== "" ? Number(lngRaw) : undefined,
  };
}
