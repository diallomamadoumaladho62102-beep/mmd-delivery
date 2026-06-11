import type { MmdLocationPoint, MmdLocationTripView } from "./mmdLocationApi";

export type MmdLocationPickerContext =
  | "taxi_pickup"
  | "taxi_dropoff"
  | "taxi_quote_pickup"
  | "taxi_quote_dropoff"
  | "delivery_dropoff"
  | "marketplace_dropoff";

export type MmdLocationPickerResult = {
  context: MmdLocationPickerContext;
  location: MmdLocationPoint;
};

type LocationDisplayInput = {
  formatted_address?: string | null;
  directions_text?: string | null;
  pin_lat?: number | null;
  pin_lng?: number | null;
  address?: string | null;
};

export function buildLocationDisplayAddress(
  location: LocationDisplayInput | MmdLocationPoint | MmdLocationTripView
): string {
  const formatted = String(location.formatted_address ?? "").trim();
  if (formatted) return formatted;

  const tripAddress =
    "address" in location ? String(location.address ?? "").trim() : "";
  if (tripAddress) return tripAddress;

  const directions = String(location.directions_text ?? "").trim();
  if (directions) return directions;

  const lat = Number(location.pin_lat);
  const lng = Number(location.pin_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  return "Pinned location";
}
