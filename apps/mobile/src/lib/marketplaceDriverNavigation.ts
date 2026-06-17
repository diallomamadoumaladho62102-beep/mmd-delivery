import { numberOrNull, toCoordinatePoint, type CoordinatePoint } from "./coordinates";

export const MARKETPLACE_DELIVERY_JOB_NAV_SELECT =
  "id,status,pickup_address,dropoff_address,estimated_distance_miles,estimated_minutes,driver_earning_cents,pickup_location_id,dropoff_location_id,assigned_driver_id,sellers(business_name,country_code),pickup:pickup_location_id(pin_lat,pin_lng,country_code),dropoff:dropoff_location_id(pin_lat,pin_lng,country_code)";

type LocationJoin = {
  pin_lat?: unknown;
  pin_lng?: unknown;
  country_code?: unknown;
};

function readLocationJoin(value: unknown): LocationJoin | null {
  if (!value || typeof value !== "object") return null;
  return value as LocationJoin;
}

export function coordsFromLocationJoin(value: unknown): CoordinatePoint | null {
  const point = readLocationJoin(value);
  if (!point) return null;
  return toCoordinatePoint(point.pin_lat, point.pin_lng);
}

export function countryCodeFromMarketplaceNavRow(
  row: Record<string, unknown> | null | undefined,
): string | null {
  if (!row) return null;

  const sellers = row.sellers as
    | { country_code?: unknown }
    | { country_code?: unknown }[]
    | null;
  const seller = Array.isArray(sellers) ? sellers[0] : sellers;
  const sellerCode = String(seller?.country_code ?? "").trim();
  if (sellerCode) return sellerCode;

  const pickupCode = String(readLocationJoin(row.pickup)?.country_code ?? "").trim();
  return pickupCode || null;
}

export function applyMarketplaceCoordsToOrder<
  T extends {
    pickup_lat: number | null;
    pickup_lng: number | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
  },
>(order: T, row: Record<string, unknown> | null | undefined): T {
  if (!row) return order;

  const pickup = coordsFromLocationJoin(row.pickup);
  const dropoff = coordsFromLocationJoin(row.dropoff);

  return {
    ...order,
    pickup_lat: pickup?.latitude ?? order.pickup_lat,
    pickup_lng: pickup?.longitude ?? order.pickup_lng,
    dropoff_lat: dropoff?.latitude ?? order.dropoff_lat,
    dropoff_lng: dropoff?.longitude ?? order.dropoff_lng,
  };
}

export function marketplaceDriverPayoutDollars(row: Record<string, unknown>): number {
  const cents = numberOrNull(row.driver_earning_cents);
  if (cents == null) return 0;
  return Math.max(0, cents / 100);
}
