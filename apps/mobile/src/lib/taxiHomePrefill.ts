import { isValidCoordinate } from "./coordinates";
import type { TaxiVehicleClass } from "./taxiClientApi";

const VEHICLE_CLASSES = new Set<TaxiVehicleClass>([
  "standard",
  "comfort",
  "xl",
  "wheelchair_accessible",
  "premium",
]);

export type TaxiHomePrefillInput = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  vehicleClass?: string;
  countryCode?: string;
  pickupLocationId?: string;
  dropoffLocationId?: string;
};

export type TaxiHomePrefill = {
  pickup: string;
  dropoff: string;
  pickupLocationId: string;
  dropoffLocationId: string;
  pickupCoords: { lat: number; lng: number } | null;
  dropoffCoords: { lat: number; lng: number } | null;
  vehicleClass: TaxiVehicleClass | null;
  countryCode: string;
};

export function taxiVehicleClassFromUnknown(value: unknown): TaxiVehicleClass | null {
  const next = String(value ?? "").trim().toLowerCase() as TaxiVehicleClass;
  return VEHICLE_CLASSES.has(next) ? next : null;
}

export function taxiHomePrefillFromParams(
  params?: TaxiHomePrefillInput | null
): TaxiHomePrefill {
  const pickupLat = Number(params?.pickupLat);
  const pickupLng = Number(params?.pickupLng);
  const dropoffLat = Number(params?.dropoffLat);
  const dropoffLng = Number(params?.dropoffLng);

  return {
    pickup: String(params?.pickupAddress ?? "").trim(),
    dropoff: String(params?.dropoffAddress ?? "").trim(),
    pickupLocationId: String(params?.pickupLocationId ?? "").trim(),
    dropoffLocationId: String(params?.dropoffLocationId ?? "").trim(),
    pickupCoords: isValidCoordinate(pickupLat, pickupLng)
      ? { lat: pickupLat, lng: pickupLng }
      : null,
    dropoffCoords: isValidCoordinate(dropoffLat, dropoffLng)
      ? { lat: dropoffLat, lng: dropoffLng }
      : null,
    vehicleClass: taxiVehicleClassFromUnknown(params?.vehicleClass),
    countryCode: String(params?.countryCode ?? "").trim().toUpperCase(),
  };
}
