import type { NextRequest } from "next/server";
import { assertNoClientDeliveryPricingFields } from "@/lib/deliveryRequestClientPricingGuard";
import type { DeliveryRequestPricingResult } from "@/lib/deliveryRequestServerPricing";
import { normalizePlatformCountryCode } from "@/lib/platformCurrency";

export type DeliveryRequestBody = {
  request_type?: "package" | "ride";
  title?: string;
  description?: string | null;
  errand_description?: string | null;
  pickup_address?: string;
  dropoff_address?: string;
  pickup_contact_name?: string | null;
  pickup_phone?: string | null;
  dropoff_contact_name?: string | null;
  dropoff_phone?: string | null;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  dropoff_location_id?: string | null;
  promo_code?: string | null;
};

export function parseDeliveryRequestBody(body: Record<string, unknown>): DeliveryRequestBody {
  assertNoClientDeliveryPricingFields(body);
  return body as DeliveryRequestBody;
}

export function readDeliveryRequestFields(body: DeliveryRequestBody): {
  requestType: "package" | "ride";
  title: string;
  description: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  pickupContactName: string | null;
  pickupPhone: string | null;
  dropoffContactName: string | null;
  dropoffPhone: string | null;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  dropoffLocationId: string | null;
  promoCode: string | null;
} {
  const requestType: "package" | "ride" = body.request_type === "ride" ? "ride" : "package";
  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? body.errand_description ?? "").trim();
  const pickupAddress = String(body.pickup_address ?? "").trim();
  const dropoffAddress = String(body.dropoff_address ?? "").trim();
  const pickupLat = Number(body.pickup_lat);
  const pickupLng = Number(body.pickup_lng);
  const dropoffLat = Number(body.dropoff_lat);
  const dropoffLng = Number(body.dropoff_lng);

  return {
    requestType,
    title,
    description: description || null,
    pickupAddress,
    dropoffAddress,
    pickupContactName: body.pickup_contact_name ?? null,
    pickupPhone: body.pickup_phone ?? null,
    dropoffContactName: body.dropoff_contact_name ?? null,
    dropoffPhone: body.dropoff_phone ?? null,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    dropoffLocationId: body.dropoff_location_id ?? null,
    promoCode: body.promo_code ?? null,
  };
}

export function validateDeliveryRequestFields(
  fields: ReturnType<typeof readDeliveryRequestFields>
) {
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
}

export function countryCodeFromDeliveryAuthScope(scope: {
  country_code?: string | null;
}): string {
  const code = normalizePlatformCountryCode(scope.country_code);
  if (!code) {
    throw new Error("market_scope_unresolved");
  }
  return code;
}

export function buildDeliveryPricingResponse(pricing: DeliveryRequestPricingResult) {
  return {
    country_code: pricing.countryCode,
    currency: pricing.currency,
    config_key: pricing.configKey,
    subtotal: pricing.subtotal,
    tax: pricing.tax,
    tax_rate_pct: pricing.taxRatePct,
    tax_source: pricing.taxSource,
    service_fee: pricing.serviceFee,
    service_fee_cents: pricing.serviceFeeCents,
    service_fee_pct: pricing.serviceFeePct,
    service_fee_enabled: pricing.serviceFeeEnabled,
    service_fee_fixed_cents: pricing.serviceFeeFixedCents,
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
  };
}

export function readDeliveryRequestScopeFromRequest(req: NextRequest) {
  const url = new URL(req.url);
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  return {
    country: url.searchParams.get("country"),
    lat: latRaw != null && latRaw !== "" ? Number(latRaw) : undefined,
    lng: lngRaw != null && lngRaw !== "" ? Number(lngRaw) : undefined,
  };
}
