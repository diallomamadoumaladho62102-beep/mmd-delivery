/**
 * Customer Taxi categories. Premium is the historical name of Comfort.
 * A missing or unknown class is an error — never an implicit Standard ride.
 */
export const TAXI_CUSTOMER_VEHICLE_CLASSES = [
  "standard",
  "comfort",
  "xl",
  "wheelchair_accessible",
] as const;

export type TaxiCustomerVehicleClass = (typeof TAXI_CUSTOMER_VEHICLE_CLASSES)[number];

const CUSTOMER_CLASS_SET = new Set<string>(TAXI_CUSTOMER_VEHICLE_CLASSES);

export function resolveTaxiCustomerVehicleClass(
  raw: unknown,
):
  | { ok: true; vehicleClass: TaxiCustomerVehicleClass }
  | { ok: false; error: "vehicle_class_required" | "vehicle_class_unsupported" } {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return { ok: false, error: "vehicle_class_required" };
  if (value === "premium") return { ok: true, vehicleClass: "comfort" };
  if (value === "wheelchair") return { ok: true, vehicleClass: "wheelchair_accessible" };
  if (CUSTOMER_CLASS_SET.has(value)) {
    return { ok: true, vehicleClass: value as TaxiCustomerVehicleClass };
  }
  return { ok: false, error: "vehicle_class_unsupported" };
}

/** Intermediate stops stored on taxi_ride_stops (stop_order 1–3). */
export const MAX_TAXI_BOOKING_STOPS = 3;

/**
 * Round trip stores the outward destination as a stop, then returns to pickup.
 * That uses one of the three stop slots, so the rider can add two stops.
 */
export function maxUserStopsForTrip(tripMode: "one_way" | "round_trip"): number {
  return tripMode === "round_trip" ? 2 : MAX_TAXI_BOOKING_STOPS;
}

export function countAddressedStops(stops: unknown): number {
  if (!Array.isArray(stops)) return 0;
  return stops.filter((stop) => {
    if (typeof stop === "string") return stop.trim().length > 0;
    if (!stop || typeof stop !== "object") return false;
    const row = stop as { address?: unknown; lat?: unknown; lng?: unknown };
    const address = String(row.address ?? "").trim();
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    return address.length > 0 || (Number.isFinite(lat) && Number.isFinite(lng));
  }).length;
}

export function taxiStopCapacityError(
  stops: unknown,
  tripMode: "one_way" | "round_trip",
): "too_many_stops" | "round_trip_stop_limit" | null {
  const count = countAddressedStops(stops);
  const limit = maxUserStopsForTrip(tripMode);
  if (count <= limit) return null;
  return tripMode === "round_trip" ? "round_trip_stop_limit" : "too_many_stops";
}
