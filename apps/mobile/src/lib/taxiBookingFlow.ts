/**
 * Pure taxi booking flow helpers — quote before create (no orphan quoted rides).
 */

/** Max intermediate stops between pickup and final dropoff. */
export const MAX_TAXI_STOPS = 5;

export type TaxiStopInput = {
  address: string;
  lat?: number;
  lng?: number;
};

export type MultiStopQuoteNavParams = {
  pickupAddress: string;
  dropoffAddress: string;
  vehicleClass: string;
  countryCode: string;
  quote: Record<string, unknown>;
  route: Record<string, unknown>;
  stops: TaxiStopInput[];
};

/**
 * Preserve stop order as entered (filter empties only).
 */
export function normalizeOrderedStops(stops: Array<string | TaxiStopInput>): TaxiStopInput[] {
  return stops
    .map((stop) => {
      if (typeof stop === "string") {
        const address = stop.trim();
        return address ? { address } : null;
      }
      const address = String(stop?.address ?? "").trim();
      if (!address) return null;
      const lat = Number(stop.lat);
      const lng = Number(stop.lng);
      return {
        address,
        ...(Number.isFinite(lat) ? { lat } : {}),
        ...(Number.isFinite(lng) ? { lng } : {}),
      };
    })
    .filter((s): s is TaxiStopInput => s != null)
    .slice(0, MAX_TAXI_STOPS);
}

/**
 * Reorder stops by moving the item at fromIndex to toIndex (stable clamp).
 */
export function reorderStops<T>(stops: T[], fromIndex: number, toIndex: number): T[] {
  if (!Array.isArray(stops) || stops.length === 0) return [];
  const from = Math.max(0, Math.min(stops.length - 1, Math.round(fromIndex)));
  const to = Math.max(0, Math.min(stops.length - 1, Math.round(toIndex)));
  if (from === to) return stops.slice();
  const next = stops.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Build navigation params after a successful quote — ride is NOT created yet.
 */
export function buildMultiStopQuoteNavigationParams(input: {
  pickupAddress: string;
  dropoffAddress: string;
  vehicleClass?: string;
  countryCode: string;
  quote: Record<string, unknown> | unknown;
  route?: Record<string, unknown> | null;
  stops: Array<string | TaxiStopInput>;
}): MultiStopQuoteNavParams {
  const stops = normalizeOrderedStops(input.stops);
  const route = {
    ...(input.route ?? {}),
    stops: (input.route as { stops?: unknown } | null)?.stops ?? stops,
  };
  return {
    pickupAddress: String(input.pickupAddress ?? "").trim(),
    dropoffAddress: String(input.dropoffAddress ?? "").trim(),
    vehicleClass: input.vehicleClass ?? "standard",
    countryCode: input.countryCode,
    quote: (input.quote ?? {}) as Record<string, unknown>,
    route,
    stops,
  };
}

/**
 * Invariant: multi-stop must quote first; create happens only at pay time.
 */
export function shouldCreateRideBeforePayment(): boolean {
  return false;
}
