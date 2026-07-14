import { Linking, Platform } from "react-native";
import * as Location from "expo-location";

export type LocationPermissionState =
  | "undetermined"
  | "granted"
  | "denied"
  | "blocked"
  | "services_off"
  | "weak_accuracy"
  | "cached"
  | "fresh"
  | "timeout"
  | "unavailable";

export type FreshPositionResult = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  state: LocationPermissionState;
  timestamp: number;
};

function mapPermissionStatus(
  status: Location.PermissionStatus,
  canAskAgain?: boolean
): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return "granted";
  if (status === Location.PermissionStatus.UNDETERMINED) return "undetermined";
  if (canAskAgain === false) return "blocked";
  return "denied";
}

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) return "services_off";

    const current = await Location.getForegroundPermissionsAsync();
    return mapPermissionStatus(current.status, current.canAskAgain);
  } catch {
    return "unavailable";
  }
}

export async function requestLocationPermission(): Promise<LocationPermissionState> {
  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) return "services_off";

    const result = await Location.requestForegroundPermissionsAsync();
    return mapPermissionStatus(result.status, result.canAskAgain);
  } catch {
    return "unavailable";
  }
}

export async function openLocationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    if (Platform.OS === "ios") {
      await Linking.openURL("app-settings:");
    }
  }
}

/**
 * Never hangs forever — resolves with timeout state if GPS stalls.
 */
export async function getFreshPosition(options?: {
  timeoutMs?: number;
  accuracy?: Location.LocationAccuracy;
  preferLastKnown?: boolean;
}): Promise<FreshPositionResult> {
  const timeoutMs = options?.timeoutMs ?? 8000;
  const accuracy = options?.accuracy ?? Location.Accuracy.Balanced;

  const permission = await requestLocationPermission();
  if (permission !== "granted") {
    return {
      latitude: NaN,
      longitude: NaN,
      accuracy: null,
      state: permission,
      timestamp: Date.now(),
    };
  }

  const race = Promise.race([
    (async (): Promise<FreshPositionResult> => {
      try {
        if (options?.preferLastKnown) {
          const last = await Location.getLastKnownPositionAsync();
          if (last?.coords) {
            return {
              latitude: last.coords.latitude,
              longitude: last.coords.longitude,
              accuracy: last.coords.accuracy ?? null,
              state: "cached",
              timestamp: last.timestamp ?? Date.now(),
            };
          }
        }

        const pos = await Location.getCurrentPositionAsync({ accuracy });
        const acc = pos.coords.accuracy ?? null;
        const weak =
          acc != null && Number.isFinite(acc) && acc > 100;

        return {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: acc,
          state: weak ? "weak_accuracy" : "fresh",
          timestamp: pos.timestamp ?? Date.now(),
        };
      } catch {
        return {
          latitude: NaN,
          longitude: NaN,
          accuracy: null,
          state: "unavailable",
          timestamp: Date.now(),
        };
      }
    })(),
    new Promise<FreshPositionResult>((resolve) => {
      setTimeout(() => {
        resolve({
          latitude: NaN,
          longitude: NaN,
          accuracy: null,
          state: "timeout",
          timestamp: Date.now(),
        });
      }, timeoutMs);
    }),
  ]);

  return race;
}
