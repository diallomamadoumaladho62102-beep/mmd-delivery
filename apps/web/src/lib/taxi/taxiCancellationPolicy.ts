/**
 * Taxi cancellation financial policy (pure SoT — no Stripe side effects).
 *
 * Client cancel after driver accept, before start → keep 30%, refund 70%.
 * Client cancel after trip start → keep 100%; driver earns 50% (not at dest)
 * or 100% of driver_payout (arrived at destination).
 *
 * Driver release after accept → no client fee; ride redispatched (not canceled).
 */

import { getPricingBusinessDefault } from "@/lib/pricingEngine/config/businessDefaults";

export const TAXI_CLIENT_CANCEL_REASONS = [
  "driver_taking_too_long",
  "driver_too_far",
  "changed_mind",
  "wrong_pickup",
  "wrong_destination",
  "found_another_option",
  "problem_with_driver",
  "problem_with_vehicle",
  "pickup_problem",
  "emergency",
  "other",
] as const;

export const TAXI_DRIVER_CANCEL_REASONS = [
  "vehicle_issue",
  "personal_emergency",
  "unsafe_pickup",
  "customer_unreachable",
  "traffic_or_route_blocked",
  "wrong_trip_details",
  "other",
] as const;

export type TaxiClientCancelReason = (typeof TAXI_CLIENT_CANCEL_REASONS)[number];
export type TaxiDriverCancelReason = (typeof TAXI_DRIVER_CANCEL_REASONS)[number];

export type TaxiCancelPhase =
  | "before_assignment"
  | "after_accept_before_start"
  | "after_start"
  | "not_cancellable";

export type ClientCancelFinancialPlan =
  | {
      ok: true;
      phase: "before_assignment";
      keepCents: 0;
      refundCents: number;
      cancelFeeCents: 0;
      driverCompensationCents: 0;
      refundPolicy: "FULL" | "NONE";
    }
  | {
      ok: true;
      phase: "after_accept_before_start";
      keepCents: number;
      refundCents: number;
      cancelFeeCents: number;
      driverCompensationCents: 0;
      refundPolicy: "PARTIAL" | "NONE";
      clientFeePct: number;
    }
  | {
      ok: true;
      phase: "after_start";
      keepCents: number;
      refundCents: 0;
      cancelFeeCents: number;
      driverCompensationCents: number;
      driverCompensationPct: number;
      refundPolicy: "NONE";
      driverAtDestination: boolean;
    }
  | { ok: false; phase: "not_cancellable"; code: string };

const METERS_PER_MILE = 1609.344;

export function getTaxiClientCancelFeePct(): number {
  const raw = getPricingBusinessDefault("taxi_client_cancel_before_start_fee_pct");
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return 30;
  return raw;
}

export function getTaxiDriverCompNotAtDestPct(): number {
  const raw = getPricingBusinessDefault(
    "taxi_driver_cancel_comp_not_at_dest_pct",
  );
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return 50;
  return raw;
}

export function getTaxiDriverCompAtDestPct(): number {
  const raw = getPricingBusinessDefault("taxi_driver_cancel_comp_at_dest_pct");
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return 100;
  return raw;
}

export function getTaxiDestinationArrivalMeters(): number {
  const raw = getPricingBusinessDefault("taxi_destination_arrival_meters");
  if (!Number.isFinite(raw) || raw <= 0) return 150;
  return raw;
}

export function normalizeTaxiCancelReason(
  value: unknown,
  allowed: readonly string[],
): string | null {
  const code = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 64);
  if (!code) return null;
  return allowed.includes(code) ? code : null;
}

export function resolveTaxiClientCancelPhase(input: {
  status: string;
  driverId: unknown;
}): TaxiCancelPhase {
  const status = String(input.status ?? "")
    .trim()
    .toLowerCase();
  const hasDriver = Boolean(String(input.driverId ?? "").trim());

  if (["canceled", "cancelled", "completed"].includes(status)) {
    return "not_cancellable";
  }
  if (["in_progress"].includes(status)) {
    return "after_start";
  }
  if (
    hasDriver &&
    ["accepted", "driver_arrived"].includes(status)
  ) {
    return "after_accept_before_start";
  }
  if (
    !hasDriver &&
    ["draft", "quoted", "pending_payment", "paid", "dispatching"].includes(
      status,
    )
  ) {
    return "before_assignment";
  }
  return "not_cancellable";
}

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** True when driver GPS is within destination-arrival radius of dropoff. */
export function isDriverAtDestination(input: {
  driverLat: number | null | undefined;
  driverLng: number | null | undefined;
  dropoffLat: number | null | undefined;
  dropoffLng: number | null | undefined;
  maxMeters?: number;
}): boolean {
  const dLat = Number(input.driverLat);
  const dLng = Number(input.driverLng);
  const oLat = Number(input.dropoffLat);
  const oLng = Number(input.dropoffLng);
  if (
    ![dLat, dLng, oLat, oLng].every((n) => Number.isFinite(n)) ||
    (Math.abs(dLat) < 1e-6 && Math.abs(dLng) < 1e-6)
  ) {
    return false;
  }
  const max = input.maxMeters ?? getTaxiDestinationArrivalMeters();
  return (
    haversineMeters({ lat: dLat, lng: dLng }, { lat: oLat, lng: oLng }) <= max
  );
}

function clampCents(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/**
 * Compute client-cancel money plan from paid ride total + driver payout snapshot.
 * Uses fare total (client paid amount) as SoT for fees.
 */
export function planClientTaxiCancellation(input: {
  status: string;
  driverId: unknown;
  paymentStatus: string;
  totalCents: number;
  driverPayoutCents: number;
  driverAtDestination?: boolean;
}): ClientCancelFinancialPlan {
  const phase = resolveTaxiClientCancelPhase({
    status: input.status,
    driverId: input.driverId,
  });
  const paid =
    String(input.paymentStatus ?? "")
      .trim()
      .toLowerCase() === "paid";
  const total = clampCents(input.totalCents);
  const driverPayout = clampCents(input.driverPayoutCents);

  if (phase === "not_cancellable") {
    return { ok: false, phase, code: "ride_not_cancellable" };
  }

  if (phase === "before_assignment") {
    return {
      ok: true,
      phase,
      keepCents: 0,
      refundCents: paid ? total : 0,
      cancelFeeCents: 0,
      driverCompensationCents: 0,
      refundPolicy: paid ? "FULL" : "NONE",
    };
  }

  if (phase === "after_accept_before_start") {
    const feePct = getTaxiClientCancelFeePct();
    const cancelFeeCents = paid ? clampCents((total * feePct) / 100) : 0;
    const refundCents = paid ? Math.max(0, total - cancelFeeCents) : 0;
    return {
      ok: true,
      phase,
      keepCents: cancelFeeCents,
      refundCents,
      cancelFeeCents,
      driverCompensationCents: 0,
      refundPolicy: paid && refundCents > 0 ? "PARTIAL" : paid ? "NONE" : "NONE",
      clientFeePct: feePct,
    };
  }

  // after_start
  const atDest = input.driverAtDestination === true;
  const compPct = atDest
    ? getTaxiDriverCompAtDestPct()
    : getTaxiDriverCompNotAtDestPct();
  const driverCompensationCents = paid
    ? clampCents((driverPayout * compPct) / 100)
    : 0;
  return {
    ok: true,
    phase,
    keepCents: paid ? total : 0,
    refundCents: 0,
    cancelFeeCents: paid ? total : 0,
    driverCompensationCents,
    driverCompensationPct: compPct,
    refundPolicy: "NONE",
    driverAtDestination: atDest,
  };
}

export function driverReleaseAffectsActivityScore(): boolean {
  return true;
}

/** Max stops after booking (aligned with DB stop_order 1–3). */
export function getTaxiMaxStops(): number {
  const raw = getPricingBusinessDefault("taxi_max_stops");
  if (!Number.isFinite(raw) || raw < 1) return 3;
  return Math.min(5, Math.floor(raw));
}

/** Block destination change when remaining straight-line to old dropoff is under this. */
export function getTaxiMinRemainingMilesForDestChange(): number {
  const raw = getPricingBusinessDefault(
    "taxi_min_remaining_miles_for_dest_change",
  );
  if (!Number.isFinite(raw) || raw < 0) return 0.3;
  return raw;
}

export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return haversineMeters(a, b) / METERS_PER_MILE;
}
