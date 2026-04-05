import * as Location from "expo-location";
import { supabase } from "./supabase";

let sub: Location.LocationSubscription | null = null;

type StartOptions = {
  driverId: string;
  timeInterval?: number; // ms
  distanceInterval?: number; // meters
};

export async function startDriverLocationTracking(opts: StartOptions) {
  const { driverId, timeInterval = 3000, distanceInterval = 10 } = opts;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission not granted");
  }

  // Avoid duplicates
  if (sub) return;

  sub = await Location.watchPositionAsync(
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

      // On ne casse pas l’app si réseau instable
      if (error) {
        // console.warn("driver_locations upsert:", error.message);
      }
    }
  );
}

export function stopDriverLocationTracking() {
  if (sub) {
    sub.remove();
    sub = null;
  }
}
