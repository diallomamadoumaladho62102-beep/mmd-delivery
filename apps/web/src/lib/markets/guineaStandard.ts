/**
 * Guinea Standard rules. Car and motorcycle stay on the existing kilometer fare.
 * XL axis prices, baggage and the 10% XL commission are not used here.
 * Pooling limits are inputs. This module does not call Mapbox.
 */

export const GUINEA_STANDARD_MAX_DISTANCE_METERS = 100_000;
export const GUINEA_STANDARD_CAR_CAPACITY = 4;
export const GUINEA_STANDARD_MOTO_CAPACITY = 1;

export type GuineaStandardVehicle = "car" | "motorcycle";

export type GuineaPoolLimits = {
  maxDetourMeters: number;
  maxExtraMinutes: number;
  maxPickupDeviationMeters: number;
};

export type GuineaPoolReservation = {
  id: string;
  status: "confirmed" | "canceled" | "completed";
  passengerCount: number;
  fareGnf: number;
};

export function resolveGuineaStandardVehicle(
  raw: unknown,
):
  | { ok: true; vehicle: GuineaStandardVehicle; capacity: number }
  | { ok: false; error: "guinea_vehicle_class_not_configured" } {
  const value = String(raw ?? "standard").trim().toLowerCase();
  if (value === "standard" || value === "car") {
    return { ok: true, vehicle: "car", capacity: GUINEA_STANDARD_CAR_CAPACITY };
  }
  if (value === "motorcycle" || value === "moto") {
    return { ok: true, vehicle: "motorcycle", capacity: GUINEA_STANDARD_MOTO_CAPACITY };
  }
  return { ok: false, error: "guinea_vehicle_class_not_configured" };
}

export function isGuineaMotorcycleClass(raw: unknown): boolean {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "motorcycle" || value === "moto";
}

export function resolveGuineaPassengerCount(
  raw: unknown,
  vehicle: GuineaStandardVehicle,
): { ok: true; passengerCount: number } | { ok: false; error: "guinea_capacity_exceeded" } {
  const capacity = vehicle === "motorcycle" ? GUINEA_STANDARD_MOTO_CAPACITY : GUINEA_STANDARD_CAR_CAPACITY;
  if (raw == null || raw === "") {
    return { ok: true, passengerCount: 1 };
  }
  const count = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isSafeInteger(count) || count < 1 || count > capacity) {
    return { ok: false, error: "guinea_capacity_exceeded" };
  }
  return { ok: true, passengerCount: count };
}

export function guineaStandardDistanceAllowed(distanceMeters: number): boolean {
  return Number.isSafeInteger(distanceMeters) && distanceMeters > 0 && distanceMeters <= GUINEA_STANDARD_MAX_DISTANCE_METERS;
}

export function readGuineaStandardCommissionBps(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const text = String(env.GUINEA_TAXI_PLATFORM_SHARE_BPS ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const bps = Number(text);
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return null;
  return bps;
}

/** Integer half-up split. The rate is the supplied configuration, not a literal. */
export function splitGuineaStandardCommission(
  fareGnf: number,
  platformShareBps: number,
): { platformFeeGnf: number; driverAmountGnf: number } | null {
  if (!Number.isSafeInteger(fareGnf) || fareGnf <= 0) return null;
  if (!Number.isSafeInteger(platformShareBps) || platformShareBps < 0 || platformShareBps > 10_000) {
    return null;
  }
  const product = fareGnf * platformShareBps + 5_000;
  if (!Number.isSafeInteger(product)) return null;
  const platformFeeGnf = Math.floor(product / 10_000);
  const driverAmountGnf = fareGnf - platformFeeGnf;
  if (platformFeeGnf + driverAmountGnf !== fareGnf) return null;
  return { platformFeeGnf, driverAmountGnf };
}

export function freezeGuineaStandardSnapshot(input: {
  distanceMeters: number;
  durationMinutes: number;
  fareGnf: number;
  platformShareBps: number;
  platformFeeGnf: number;
  driverAmountGnf: number;
  baseFareGnf: number;
  perKmGnf: number;
  perMinuteGnf: number;
  minimumFareGnf: number;
  maximumFareGnf: number | null;
  vehicle: GuineaStandardVehicle;
  passengerCount: number;
  quotedAt: string;
}) {
  return {
    market: "GN" as const,
    currency: "GNF" as const,
    distance_meters: input.distanceMeters,
    duration_minutes: input.durationMinutes,
    fare_gnf: input.fareGnf,
    platform_share_bps: input.platformShareBps,
    platform_fee_gnf: input.platformFeeGnf,
    driver_amount_gnf: input.driverAmountGnf,
    base_fare_gnf: input.baseFareGnf,
    per_km_gnf: input.perKmGnf,
    per_minute_gnf: input.perMinuteGnf,
    minimum_fare_gnf: input.minimumFareGnf,
    maximum_fare_gnf: input.maximumFareGnf,
    vehicle_kind: input.vehicle,
    passenger_count: input.passengerCount,
    quoted_at: input.quotedAt,
  };
}

export function activeGuineaPassengers(rows: GuineaPoolReservation[]): number {
  return rows
    .filter((row) => row.status === "confirmed")
    .reduce((sum, row) => sum + row.passengerCount, 0);
}

export function cancelGuineaPoolReservation(
  rows: GuineaPoolReservation[],
  reservationId: string,
): GuineaPoolReservation[] {
  return rows.map((row) =>
    row.id === reservationId ? { ...row, status: "canceled" } : { ...row },
  );
}

export function evaluateGuineaPool(input: {
  vehicle: GuineaStandardVehicle;
  driverOnline: boolean;
  poolable: boolean;
  existing: GuineaPoolReservation[];
  incomingPassengers: number;
  detourMeters: number;
  extraMinutes: number;
  pickupDeviationMeters: number;
  oppositeDirection: boolean;
  limits: GuineaPoolLimits;
}):
  | { ok: true; activePassengers: number; remainingSeats: number }
  | { ok: false; error: string } {
  if (input.vehicle === "motorcycle") {
    return { ok: false, error: "guinea_motorcycle_pool_forbidden" };
  }
  if (!input.driverOnline) return { ok: false, error: "driver_unavailable" };
  if (!input.poolable || input.oppositeDirection) {
    return { ok: false, error: "guinea_pool_incompatible" };
  }
  if (input.detourMeters > input.limits.maxDetourMeters) {
    return { ok: false, error: "guinea_pool_detour" };
  }
  if (input.extraMinutes > input.limits.maxExtraMinutes) {
    return { ok: false, error: "guinea_pool_time" };
  }
  if (input.pickupDeviationMeters > input.limits.maxPickupDeviationMeters) {
    return { ok: false, error: "guinea_pool_pickup" };
  }
  const incoming = input.incomingPassengers;
  if (!Number.isSafeInteger(incoming) || incoming < 1) {
    return { ok: false, error: "guinea_capacity_exceeded" };
  }
  const next = activeGuineaPassengers(input.existing) + incoming;
  if (next > GUINEA_STANDARD_CAR_CAPACITY) {
    return { ok: false, error: "guinea_capacity_exceeded" };
  }
  return {
    ok: true,
    activePassengers: next,
    remainingSeats: GUINEA_STANDARD_CAR_CAPACITY - next,
  };
}

export function guineaStopOrderValid(
  stops: Array<{ reservationId: string; kind: "pickup" | "dropoff" }>,
): boolean {
  const seen = new Map<string, { pickup: number; dropoff: number }>();
  stops.forEach((stop, index) => {
    const row = seen.get(stop.reservationId) ?? { pickup: -1, dropoff: -1 };
    if (stop.kind === "pickup") row.pickup = index;
    else row.dropoff = index;
    seen.set(stop.reservationId, row);
  });
  if (seen.size === 0) return false;
  for (const row of seen.values()) {
    if (row.pickup < 0 || row.dropoff < 0 || row.pickup >= row.dropoff) return false;
  }
  return true;
}
