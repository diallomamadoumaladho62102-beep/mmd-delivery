import * as Location from "expo-location";
import { supabase } from "./supabase";
import { distanceMeters } from "./coordinates";
import { isDriverPresenceTrackingActive } from "./location";

let sub: Location.LocationSubscription | null = null;
let startInFlight: Promise<void> | null = null;

const LIVE_UPSERT_MIN_INTERVAL_MS = 3000;
const LIVE_UPSERT_MIN_DISTANCE_METERS = 10;

let lastLiveUpsert: {
  driverId: string;
  at: number;
  lat: number;
  lng: number;
} | null = null;

/** Upsert throttled — réutilise le GPS navigation sans second abonnement. */
export async function upsertDriverLiveLocation(
  driverId: string,
  latitude: number,
  longitude: number
): Promise<void> {
  if (!driverId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  const now = Date.now();
  const previous = lastLiveUpsert;
  if (
    previous &&
    previous.driverId === driverId &&
    now - previous.at < LIVE_UPSERT_MIN_INTERVAL_MS &&
    distanceMeters(previous.lat, previous.lng, latitude, longitude) <
      LIVE_UPSERT_MIN_DISTANCE_METERS
  ) {
    return;
  }

  lastLiveUpsert = { driverId, at: now, lat: latitude, lng: longitude };

  const { error } = await supabase.from("driver_locations").upsert({
    driver_id: driverId,
    lat: latitude,
    lng: longitude,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    // Réseau instable — ne pas bloquer la navigation.
  }
}

type StartOptions = {
  driverId: string;
  timeInterval?: number; // ms
  distanceInterval?: number; // meters
};

export async function startDriverLocationTracking(opts: StartOptions) {
  const { driverId, timeInterval = 3000, distanceInterval = 10 } = opts;

  // Presence tracker on Driver Home already upserts — avoid a second watch.
  if (isDriverPresenceTrackingActive() || sub) {
    return;
  }
  if (startInFlight) {
    await startInFlight;
    return;
  }

  startInFlight = (async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        throw new Error("Location permission not granted");
      }

      if (isDriverPresenceTrackingActive() || sub) {
        return;
      }

      const next = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval,
          distanceInterval,
        },
        async (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const updated_at = new Date().toISOString();

          const { error } = await supabase
            .from("driver_locations")
            .upsert({ driver_id: driverId, lat, lng, updated_at });

          if (error) {
            // Réseau instable — ne pas casser la navigation.
          }
        }
      );

      if (isDriverPresenceTrackingActive()) {
        next.remove();
        return;
      }

      sub = next;
    } finally {
      startInFlight = null;
    }
  })();

  await startInFlight;
}

export function stopDriverLocationTracking() {
  if (sub) {
    sub.remove();
    sub = null;
  }
}
