/**
 * Phase 5B — PE-owned Delivery Fee V1 (Food / Package).
 * Formula mirrored from legacy computeDeliveryPricing — owned by Pricing Engine.
 */
import { getPricingBusinessDefaults } from "../../config/businessDefaults";
import { roundMoney2 } from "./money";

export type DeliveryFeeV1Params = {
  distanceMiles: number;
  durationMinutes: number;
};

export type DeliveryFeeV1Config = {
  baseFare?: number;
  perMile?: number;
  perMinute?: number;
  minFare?: number;
  driverSharePct?: number;
  platformSharePct?: number;
};

export type DeliveryFeeV1Result = {
  deliveryFee: number;
  platformFee: number;
  driverPayout: number;
};

export function getDefaultDeliveryFeeV1Config(): Required<DeliveryFeeV1Config> {
  const d = getPricingBusinessDefaults();
  return {
    baseFare: d.delivery_base_fare,
    perMile: d.delivery_per_mile,
    perMinute: d.delivery_per_minute,
    minFare: d.delivery_min_fare,
    driverSharePct: d.delivery_driver_share_pct,
    platformSharePct: d.delivery_platform_share_pct,
  };
}

function normalizeConfig(
  config?: DeliveryFeeV1Config
): Required<DeliveryFeeV1Config> {
  const defaults = getDefaultDeliveryFeeV1Config();
  return {
    baseFare: config?.baseFare ?? defaults.baseFare,
    perMile: config?.perMile ?? defaults.perMile,
    perMinute: config?.perMinute ?? defaults.perMinute,
    minFare: config?.minFare ?? defaults.minFare,
    driverSharePct: config?.driverSharePct ?? defaults.driverSharePct,
    platformSharePct: config?.platformSharePct ?? defaults.platformSharePct,
  };
}

/** Rate card → customer delivery fee + platform/driver split (residual driver). */
export function computeDeliveryFeeV1(
  params: DeliveryFeeV1Params,
  config?: DeliveryFeeV1Config
): DeliveryFeeV1Result {
  const distanceMiles = Number(params.distanceMiles);
  const durationMinutes = Number(params.durationMinutes);
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) {
    throw new Error("delivery_fee_v1_invalid_distance");
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0) {
    throw new Error("delivery_fee_v1_invalid_duration");
  }

  const cfg = normalizeConfig(config);
  const rawFare =
    cfg.baseFare + distanceMiles * cfg.perMile + durationMinutes * cfg.perMinute;
  const deliveryFee = roundMoney2(Math.max(cfg.minFare, rawFare));
  return splitDeliveryFeeV1(deliveryFee, cfg);
}

/** Split an already-determined delivery fee (e.g. after promo) via PE share rules. */
export function splitDeliveryFeeV1(
  deliveryFee: number,
  config?: DeliveryFeeV1Config
): DeliveryFeeV1Result {
  const cfg = normalizeConfig(config);
  const fee = roundMoney2(Math.max(0, Number(deliveryFee) || 0));
  const platformFee = roundMoney2(fee * (cfg.platformSharePct / 100));
  const driverPayout = roundMoney2(fee - platformFee);
  return { deliveryFee: fee, platformFee, driverPayout };
}
