import type { DeliveryPricingResult } from "@/lib/deliveryPricing";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { runDeliveryPricingV2Engine, shadowCompareV1V2 } from "./shadowCompare";
import type { DeliveryPricingShadowLogInput } from "./types";

export function isDeliveryPricingV2ShadowEnabled(): boolean {
  return process.env.DELIVERY_PRICING_V2_SHADOW_ENABLED === "true";
}

function v1ToCents(dollars: number): number {
  return Math.round(Math.round((dollars + Number.EPSILON) * 100));
}

/**
 * Runs V2 in parallel with V1 snapshot and persists a shadow log row.
 * Never throws — V1 remains source of truth even when logging fails.
 */
export async function logDeliveryPricingV2Shadow(
  params: DeliveryPricingShadowLogInput & {
    v1Pricing: DeliveryPricingResult;
    distanceMiles: number;
    durationMinutes: number;
  }
): Promise<void> {
  if (!isDeliveryPricingV2ShadowEnabled()) {
    return;
  }

  try {
    const v1CustomerTotalCents =
      params.v1CustomerTotalCents ??
      v1ToCents(params.v1Pricing.deliveryFee);
    const v1DriverEarningCents =
      params.v1DriverEarningCents ??
      v1ToCents(params.v1Pricing.driverPayout);
    const v1PlatformMarginCents =
      v1CustomerTotalCents - v1DriverEarningCents;

    const v2Engine = runDeliveryPricingV2Engine({
      distanceMiles: params.distanceMiles,
      durationMinutes: params.durationMinutes,
      customer: {
        baseFee:
          typeof params.inputs.baseFee === "number"
            ? params.inputs.baseFee
            : undefined,
        perMile:
          typeof params.inputs.perMile === "number"
            ? params.inputs.perMile
            : undefined,
        perMinute:
          typeof params.inputs.perMinute === "number"
            ? params.inputs.perMinute
            : undefined,
      },
      driver: {
        demandLevel:
          typeof params.inputs.demandLevel === "number"
            ? params.inputs.demandLevel
            : undefined,
        activeDriversInZone:
          typeof params.inputs.activeDriversInZone === "number"
            ? params.inputs.activeDriversInZone
            : undefined,
        pickupDistanceMiles:
          typeof params.inputs.pickupDistanceMiles === "number"
            ? params.inputs.pickupDistanceMiles
            : undefined,
      },
    });

    const comparison = shadowCompareV1V2(
      {
        customerTotalCents: v1CustomerTotalCents,
        driverEarningCents: v1DriverEarningCents,
        platformMarginCents: v1PlatformMarginCents,
      },
      v2Engine
    );

    const supabase = buildSupabaseAdminClient();
    const { error } = await supabase.from("delivery_pricing_shadow_logs").insert({
      source_type: params.sourceType,
      source_id: params.sourceId ?? null,
      country_code: params.countryCode ?? null,
      region_code: params.regionCode ?? null,
      zone_code: params.zoneCode ?? null,
      old_customer_total_cents: comparison.v1.customerTotalCents,
      old_driver_earning_cents: comparison.v1.driverEarningCents,
      v2_customer_total_cents: comparison.v2.customerTotalCents,
      v2_driver_earning_cents: comparison.v2.driverEarningCents,
      v2_platform_margin_cents: comparison.v2.platformMarginCents,
      diff_customer_cents: comparison.diffCustomerCents,
      diff_driver_cents: comparison.diffDriverCents,
      diff_margin_cents: comparison.diffMarginCents,
      pricing_engine_version: "v2_shadow",
      inputs: {
        ...params.inputs,
        distanceMiles: params.distanceMiles,
        durationMinutes: params.durationMinutes,
        v1: {
          deliveryFee: params.v1Pricing.deliveryFee,
          platformFee: params.v1Pricing.platformFee,
          driverPayout: params.v1Pricing.driverPayout,
        },
        v2: {
          customer: v2Engine.customer,
          driver: v2Engine.driver,
          platform: v2Engine.platform,
        },
      },
    });

    if (error) {
      console.warn("[delivery-pricing-v2-shadow] insert failed:", error.message);
    }
  } catch (error) {
    console.warn(
      "[delivery-pricing-v2-shadow] shadow compare failed:",
      error instanceof Error ? error.message : error
    );
  }
}
