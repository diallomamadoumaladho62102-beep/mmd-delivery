import type {
  DriverDeliveryEarningInput,
  DriverDeliveryEarningResult,
} from "./types";

const DEFAULTS = {
  basePerMile: 0.72,
  basePerMinute: 0.12,
  driverScore: 50,
  driverRanking: 50,
  activeDriversInZone: 1,
  demandLevel: 0,
  pickupDistanceMiles: 0,
  zoneBonusMultiplier: 1,
} as const;

function assertNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite number >= 0`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(dollars: number): number {
  return Math.round(round2(Math.max(0, dollars)) * 100);
}

/**
 * V2 driver earning model (shadow only).
 * Uses distance/time base, driver score, demand, pickup distance, and future zone bonus.
 */
export function calculateDriverDeliveryEarning(
  input: DriverDeliveryEarningInput
): DriverDeliveryEarningResult {
  assertNonNegative(input.distanceMiles, "distanceMiles");
  assertNonNegative(input.durationMinutes, "durationMinutes");

  const basePerMile = input.basePerMile ?? DEFAULTS.basePerMile;
  const basePerMinute = input.basePerMinute ?? DEFAULTS.basePerMinute;
  const driverScore = clamp(input.driverScore ?? DEFAULTS.driverScore, 0, 100);
  const driverRanking = clamp(input.driverRanking ?? DEFAULTS.driverRanking, 0, 100);
  const activeDriversInZone = Math.max(
    0,
    Math.round(input.activeDriversInZone ?? DEFAULTS.activeDriversInZone)
  );
  const demandLevel = clamp(input.demandLevel ?? DEFAULTS.demandLevel, 0, 1);
  const pickupDistanceMiles =
    input.pickupDistanceMiles ?? DEFAULTS.pickupDistanceMiles;
  const zoneBonusMultiplier =
    input.zoneBonusMultiplier ?? DEFAULTS.zoneBonusMultiplier;

  assertNonNegative(basePerMile, "basePerMile");
  assertNonNegative(basePerMinute, "basePerMinute");
  assertNonNegative(pickupDistanceMiles, "pickupDistanceMiles");
  assertNonNegative(zoneBonusMultiplier, "zoneBonusMultiplier");

  const distanceComponent = round2(input.distanceMiles * basePerMile);
  const timeComponent = round2(input.durationMinutes * basePerMinute);
  const baseEarning = distanceComponent + timeComponent;

  const scoreMultiplier = round2(0.9 + (driverScore / 100) * 0.2);
  const rankingMultiplier = round2(0.95 + (driverRanking / 100) * 0.1);
  const supplyFactor =
    activeDriversInZone <= 0
      ? 1
      : round2(1 + demandLevel * Math.min(0.2, 5 / activeDriversInZone));
  const demandMultiplier = round2(1 + demandLevel * 0.15);
  const pickupAdjustment = round2(Math.min(pickupDistanceMiles * 0.05, 0.75));

  const earning = round2(
    Math.max(
      0,
      baseEarning *
        scoreMultiplier *
        rankingMultiplier *
        supplyFactor *
        demandMultiplier *
        zoneBonusMultiplier -
        pickupAdjustment
    )
  );

  return {
    earningCents: toCents(earning),
    distanceComponentCents: toCents(distanceComponent),
    timeComponentCents: toCents(timeComponent),
    scoreMultiplier,
    demandMultiplier: round2(demandMultiplier * supplyFactor),
    pickupAdjustmentCents: toCents(pickupAdjustment),
    zoneBonusMultiplier,
  };
}
