export type TaxiTripMode = "one_way" | "round_trip";
export type TaxiReturnMode = "immediate" | "wait" | "scheduled" | null;

export function normalizeTaxiTripMode(value: unknown): TaxiTripMode {
  const raw = String(value ?? "one_way").trim().toLowerCase();
  return raw === "round_trip" ? "round_trip" : "one_way";
}

export function normalizeTaxiReturnMode(
  tripMode: TaxiTripMode,
  value: unknown,
): TaxiReturnMode {
  if (tripMode !== "round_trip") return null;
  const raw = String(value ?? "immediate").trim().toLowerCase();
  if (raw === "wait") return "wait";
  if (raw === "scheduled") return "scheduled";
  return "immediate";
}

export function normalizeReturnWaitMinutes(
  returnMode: TaxiReturnMode,
  value: unknown,
): number | null {
  if (returnMode !== "wait") return null;
  const n = Math.round(Number(value ?? 15));
  if (!Number.isFinite(n)) return 15;
  return Math.min(180, Math.max(5, n));
}

export function normalizeReturnScheduledAt(
  returnMode: TaxiReturnMode,
  value: unknown,
): string | null {
  if (returnMode !== "scheduled") return null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * For round-trips, append the outward dropoff as a stop and set final destination
 * back to the original pickup so distance/duration/price include the return leg.
 */
export function buildRoundTripRouteInput<T extends {
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  stops?: Array<{ address?: string; lat?: number; lng?: number }>;
}>(input: T, tripMode: TaxiTripMode): T {
  if (tripMode !== "round_trip") return input;

  const outwardDropoff = {
    address: String(input.dropoffAddress ?? "").trim() || "Destination",
    ...(Number.isFinite(Number(input.dropoffLat))
      ? { lat: Number(input.dropoffLat) }
      : {}),
    ...(Number.isFinite(Number(input.dropoffLng))
      ? { lng: Number(input.dropoffLng) }
      : {}),
  };

  const existingStops = Array.isArray(input.stops) ? input.stops.slice(0, 4) : [];

  return {
    ...input,
    stops: [...existingStops, outwardDropoff],
    dropoffAddress: input.pickupAddress,
    dropoffLat: input.pickupLat,
    dropoffLng: input.pickupLng,
  };
}
