import { distanceMeters } from "@/lib/driverZones";
import {
  DRIVER_ARRIVAL_MANUAL_REVIEW_METERS,
  DRIVER_ARRIVAL_MAX_METERS,
} from "@/lib/waitTimerTypes";

export const TAXI_DROPOFF_COMPLETE_MAX_METERS = 150;

export function parseRequiredTaxiGps(body: Record<string, unknown>):
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string } {
  const lat = Number(body.lat ?? body.latitude ?? body.driver_lat ?? body.driverLat);
  const lng = Number(body.lng ?? body.longitude ?? body.driver_lng ?? body.driverLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "driver_gps_required" };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: "driver_gps_invalid" };
  }
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) {
    return { ok: false, error: "driver_gps_invalid" };
  }

  return { ok: true, lat, lng };
}

export function assertTaxiPickupProximity(input: {
  driverLat: number;
  driverLng: number;
  pickupLat: number | null | undefined;
  pickupLng: number | null | undefined;
}):
  | { ok: true; distanceMeters: number }
  | { ok: false; error: string; distanceMeters: number | null } {
  if (input.pickupLat == null || input.pickupLng == null) {
    return { ok: false, error: "pickup_coordinates_missing", distanceMeters: null };
  }

  const dist = distanceMeters(
    input.driverLat,
    input.driverLng,
    Number(input.pickupLat),
    Number(input.pickupLng),
  );

  if (dist <= DRIVER_ARRIVAL_MAX_METERS) {
    return { ok: true, distanceMeters: dist };
  }

  if (dist <= DRIVER_ARRIVAL_MANUAL_REVIEW_METERS) {
    return { ok: false, error: "manual_arrival_required", distanceMeters: dist };
  }

  return { ok: false, error: "too_far_from_pickup", distanceMeters: dist };
}

export function assertTaxiDropoffProximity(input: {
  driverLat: number;
  driverLng: number;
  dropoffLat: number | null | undefined;
  dropoffLng: number | null | undefined;
}):
  | { ok: true; distanceMeters: number }
  | { ok: false; error: string; distanceMeters: number | null } {
  if (input.dropoffLat == null || input.dropoffLng == null) {
    return { ok: false, error: "dropoff_coordinates_missing", distanceMeters: null };
  }

  const dist = distanceMeters(
    input.driverLat,
    input.driverLng,
    Number(input.dropoffLat),
    Number(input.dropoffLng),
  );

  if (dist <= TAXI_DROPOFF_COMPLETE_MAX_METERS) {
    return { ok: true, distanceMeters: dist };
  }

  return { ok: false, error: "too_far_from_dropoff", distanceMeters: dist };
}
