import type {
  CustomerDeliveryPriceInput,
  CustomerDeliveryPriceResult,
} from "./types";
import { getPricingBusinessDefaults } from "@/lib/pricingEngine/config/businessDefaults";

const _d = getPricingBusinessDefaults();

const DEFAULTS = {
  baseFee: _d.delivery_v2_base_fee,
  perMinute: _d.delivery_v2_per_minute,
  perMile: _d.delivery_v2_per_mile,
  serviceFee: _d.delivery_v2_service_fee,
  surgeMultiplier: _d.delivery_v2_surge_multiplier,
  minTotal: _d.delivery_v2_min_total,
} as const;

function assertNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite number >= 0`);
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(dollars: number): number {
  return Math.round(round2(dollars) * 100);
}

/**
 * V2 customer delivery price (shadow only).
 * Adds explicit service_fee and optional surge multiplier on top of distance/time components.
 */
export function calculateCustomerDeliveryPrice(
  input: CustomerDeliveryPriceInput
): CustomerDeliveryPriceResult {
  assertNonNegative(input.distanceMiles, "distanceMiles");
  assertNonNegative(input.durationMinutes, "durationMinutes");

  const baseFee = input.baseFee ?? DEFAULTS.baseFee;
  const perMinute = input.perMinute ?? DEFAULTS.perMinute;
  const perMile = input.perMile ?? DEFAULTS.perMile;
  const serviceFee = input.serviceFee ?? DEFAULTS.serviceFee;
  const surgeMultiplier = input.surgeMultiplier ?? DEFAULTS.surgeMultiplier;
  const minTotal = input.minTotal ?? DEFAULTS.minTotal;

  assertNonNegative(baseFee, "baseFee");
  assertNonNegative(perMinute, "perMinute");
  assertNonNegative(perMile, "perMile");
  assertNonNegative(serviceFee, "serviceFee");
  assertNonNegative(surgeMultiplier, "surgeMultiplier");
  assertNonNegative(minTotal, "minTotal");

  const distanceComponent = round2(input.distanceMiles * perMile);
  const timeComponent = round2(input.durationMinutes * perMinute);
  const subtotal = round2(baseFee + distanceComponent + timeComponent + serviceFee);
  const total = round2(Math.max(minTotal, subtotal * surgeMultiplier));

  return {
    totalCents: toCents(total),
    baseFeeCents: toCents(baseFee),
    distanceComponentCents: toCents(distanceComponent),
    timeComponentCents: toCents(timeComponent),
    serviceFeeCents: toCents(serviceFee),
    surgeMultiplier,
  };
}
