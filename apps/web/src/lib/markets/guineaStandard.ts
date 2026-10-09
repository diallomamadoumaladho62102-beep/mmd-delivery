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

function readConfiguredWhole(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/** Pooling stays off until every threshold is explicitly configured. */
export function readGuineaPoolLimits(
  env: Record<string, string | undefined> = process.env,
): GuineaPoolLimits | null {
  const maxDetourMeters = readConfiguredWhole(env.GUINEA_STANDARD_MAX_DETOUR_METERS);
  const maxExtraMinutes = readConfiguredWhole(env.GUINEA_STANDARD_MAX_EXTRA_MINUTES);
  const maxPickupDeviationMeters = readConfiguredWhole(
    env.GUINEA_STANDARD_MAX_PICKUP_DEVIATION_METERS,
  );
  if (maxDetourMeters == null || maxExtraMinutes == null || maxPickupDeviationMeters == null) {
    return null;
  }
  return { maxDetourMeters, maxExtraMinutes, maxPickupDeviationMeters };
}

/**
 * A first passenger can leave immediately.
 * Joining another ride requires configured thresholds and a compared route.
 * Missing thresholds do not invent a detour limit and do not cancel the trip.
 */
export function planGuineaStandardPool(input: {
  sharedRide: boolean;
  vehicle: GuineaStandardVehicle;
  limits: GuineaPoolLimits | null;
  compared?: {
    existing: GuineaPoolReservation[];
    incomingPassengers: number;
    detourMeters: number;
    extraMinutes: number;
    pickupDeviationMeters: number;
    oppositeDirection: boolean;
    driverOnline: boolean;
    poolable: boolean;
  } | null;
}):
  | { action: "solo"; reason: string }
  | { action: "join"; activePassengers: number; remainingSeats: number }
  | { action: "refuse"; error: string } {
  if (!input.sharedRide || input.vehicle === "motorcycle") {
    return { action: "solo", reason: input.vehicle === "motorcycle" ? "guinea_motorcycle_pool_forbidden" : "not_requested" };
  }
  if (!input.limits) return { action: "solo", reason: "guinea_pool_not_configured" };
  if (!input.compared) return { action: "solo", reason: "guinea_pool_route_required" };
  const decision = evaluateGuineaPool({
    vehicle: "car",
    limits: input.limits,
    ...input.compared,
  });
  if (decision.ok === false) return { action: "refuse", error: decision.error };
  return {
    action: "join",
    activePassengers: decision.activePassengers,
    remainingSeats: decision.remainingSeats,
  };
}

export type GuineaPoolSearchBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/** Bounding box around one pickup. A search must not scan every Guinea ride. */
export function guineaPoolSearchBounds(
  lat: number,
  lng: number,
  radiusMeters: number,
): GuineaPoolSearchBounds | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters < 0) return null;
  const latDelta = radiusMeters / 111_320;
  const cosine = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radiusMeters / (111_320 * Math.max(Math.abs(cosine), 0.2));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export type GuineaPoolSearchRow = {
  id: string;
  countryCode: string;
  currency: string;
  vehicleClass: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  pickupLat: number;
  pickupLng: number;
};

/** Keeps only nearby Standard cash rides. The caller supplies the already bounded rows. */
export function filterGuineaPoolSearchRows(input: {
  rows: GuineaPoolSearchRow[];
  bounds: GuineaPoolSearchBounds;
  excludeId?: string;
  limit: number;
}): GuineaPoolSearchRow[] {
  const cap = Math.min(Math.max(Math.trunc(input.limit), 0), 20);
  const matched: GuineaPoolSearchRow[] = [];
  for (const row of input.rows) {
    if (matched.length >= cap) break;
    if (input.excludeId && row.id === input.excludeId) continue;
    if (row.countryCode !== "GN" || row.currency !== "GNF") continue;
    if (row.vehicleClass !== "standard") continue;
    if (row.status !== "dispatching" && row.status !== "accepted") continue;
    if (row.paymentMethod !== "cash" || row.paymentStatus !== "pending_cash") continue;
    if (row.pickupLat < input.bounds.minLat || row.pickupLat > input.bounds.maxLat) continue;
    if (row.pickupLng < input.bounds.minLng || row.pickupLng > input.bounds.maxLng) continue;
    matched.push(row);
  }
  return matched;
}

export type GuineaPoolMeasuredCandidate = {
  id: string;
  passengerCount: number;
  fareGnf: number;
  detourMeters: number;
  extraMinutes: number;
  pickupDeviationMeters: number;
  oppositeDirection: boolean;
  driverOnline: boolean;
  poolable: boolean;
  proposalExpiresAtMs: number;
};

/**
 * Matching stays inactive when thresholds are missing.
 * A proposal does not change an accepted fare and does not join by itself.
 */
export function chooseGuineaPoolProposal(input: {
  sharedRide: boolean;
  vehicle: GuineaStandardVehicle;
  limits: GuineaPoolLimits | null;
  incomingPassengers: number;
  candidates: GuineaPoolMeasuredCandidate[];
  nowMs: number;
}):
  | { action: "solo"; reason: string }
  | {
      action: "propose";
      candidateId: string;
      keptFareGnf: number;
      activePassengers: number;
      remainingSeats: number;
    }
  | { action: "refuse"; error: string } {
  if (!input.sharedRide || input.vehicle === "motorcycle") {
    return {
      action: "solo",
      reason: input.vehicle === "motorcycle" ? "guinea_motorcycle_pool_forbidden" : "not_requested",
    };
  }
  if (!input.limits) return { action: "solo", reason: "guinea_pool_not_configured" };
  const fresh = input.candidates.filter((candidate) => candidate.proposalExpiresAtMs > input.nowMs);
  if (input.candidates.length > 0 && fresh.length === 0) {
    return { action: "solo", reason: "guinea_pool_proposal_expired" };
  }
  if (fresh.length === 0) return { action: "solo", reason: "guinea_pool_no_candidate" };
  for (const candidate of fresh) {
    const decision = evaluateGuineaPool({
      vehicle: "car",
      driverOnline: candidate.driverOnline,
      poolable: candidate.poolable,
      existing: [
        {
          id: candidate.id,
          status: "confirmed",
          passengerCount: candidate.passengerCount,
          fareGnf: candidate.fareGnf,
        },
      ],
      incomingPassengers: input.incomingPassengers,
      detourMeters: candidate.detourMeters,
      extraMinutes: candidate.extraMinutes,
      pickupDeviationMeters: candidate.pickupDeviationMeters,
      oppositeDirection: candidate.oppositeDirection,
      limits: input.limits,
    });
    if (decision.ok) {
      return {
        action: "propose",
        candidateId: candidate.id,
        keptFareGnf: candidate.fareGnf,
        activePassengers: decision.activePassengers,
        remainingSeats: decision.remainingSeats,
      };
    }
  }
  return { action: "refuse", error: "guinea_pool_incompatible" };
}

/** Refusing one proposal cancels only that reservation. */
export function declineGuineaPoolProposal(
  rows: GuineaPoolReservation[],
  proposalId: string,
): GuineaPoolReservation[] {
  return cancelGuineaPoolReservation(rows, proposalId);
}

/** A save must carry the timestamp read from the current row. */
export function guineaStandardSaveConflicts(
  currentUpdatedAt: string | null | undefined,
  expectedUpdatedAt: unknown,
): boolean {
  if (!currentUpdatedAt) return false;
  return String(expectedUpdatedAt ?? "") !== currentUpdatedAt;
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
function wholeNonNegative(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const amount = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return amount;
}

export function validateGuineaStandardSettings(input: {
  baseFareGnf: unknown;
  perKmGnf: unknown;
  perMinuteGnf: unknown;
  minimumFareGnf: unknown;
  platformShareBps: unknown;
  maximumFareGnf?: unknown;
}):
  | {
      ok: true;
      baseFareGnf: number;
      perKmGnf: number;
      perMinuteGnf: number;
      minimumFareGnf: number;
      maximumFareGnf: number | null;
      platformShareBps: number;
    }
  | { ok: false; error: "guinea_rate_invalid" | "guinea_commission_not_configured" } {
  const baseFareGnf = wholeNonNegative(input.baseFareGnf);
  const perKmGnf = wholeNonNegative(input.perKmGnf);
  const perMinuteGnf = wholeNonNegative(input.perMinuteGnf);
  const minimumFareGnf = wholeNonNegative(input.minimumFareGnf);
  const platformShareBps = wholeNonNegative(input.platformShareBps);
  const maximumProvided = input.maximumFareGnf != null && input.maximumFareGnf !== "";
  const maximumFareGnf = maximumProvided ? wholeNonNegative(input.maximumFareGnf) : null;
  if (
    baseFareGnf == null ||
    perKmGnf == null ||
    perMinuteGnf == null ||
    minimumFareGnf == null ||
    (maximumProvided && maximumFareGnf == null)
  ) {
    return { ok: false, error: "guinea_rate_invalid" };
  }
  if (platformShareBps == null || platformShareBps > 10_000) {
    return { ok: false, error: "guinea_commission_not_configured" };
  }
  return {
    ok: true,
    baseFareGnf,
    perKmGnf,
    perMinuteGnf,
    minimumFareGnf,
    maximumFareGnf,
    platformShareBps,
  };
}

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
