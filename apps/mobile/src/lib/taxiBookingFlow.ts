/**
 * Pure taxi booking flow helpers — quote before create (no orphan quoted rides).
 */

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
    .filter((s): s is TaxiStopInput => s != null);
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
