import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { supabase } from "./supabase";

const DRIVER_LOCATION_TASK = "MMD_DRIVER_BACKGROUND_LOCATION_TASK";
const KEEP_AWAKE_TAG = "mmd-driver-location-tracking";

let isTrackingStarted = false;
let locationSubscription: Location.LocationSubscription | null = null;
let appStateSubscription: { remove: () => void } | null = null;

type TrackingOptions = {
  intervalMs?: number;
};

type DriverLocationPayload = {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

const DEV_DRIVER_EMAIL = "diallomamadoumaladho62102@gmail.com";
const DEV_DRIVER_PASSWORD = "mmd12345";

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

function logInfo(message: string, ...args: unknown[]) {
  console.log(`ℹ️ ${message}`, ...args);
}

function logSuccess(message: string, ...args: unknown[]) {
  console.log(`✅ ${message}`, ...args);
}

function logError(message: string, ...args: unknown[]) {
  console.log(`❌ ${message}`, ...args);
}

async function sendDriverLocationToSupabase(
  payload: DriverLocationPayload,
): Promise<void> {
  const { error } = await supabase.from("driver_locations").upsert(
    {
      driver_id: payload.driver_id,
      lat: payload.lat,
      lng: payload.lng,
      updated_at: payload.updated_at,
    },
    { onConflict: "driver_id" },
  );

  if (error) {
    logError("driver_locations upsert error:", error);
    return;
  }

  logSuccess("GPS envoyé:", payload.lat, payload.lng);
}

async function getOrLoginDriverUser() {
  const { data, error } = await supabase.auth.getUser();

  if (!error && data?.user) {
    return data.user;
  }

  if (!IS_DEV) {
    logError("Aucune session chauffeur active en production.");
    return null;
  }

  logInfo("Pas de session active. Tentative de login DEV avec le chauffeur...");

  const { data: loginData, error: loginError } =
    await supabase.auth.signInWithPassword({
      email: DEV_DRIVER_EMAIL,
      password: DEV_DRIVER_PASSWORD,
    });

  if (loginError || !loginData?.user) {
    logError(
      "Impossible de se connecter avec le compte DEV:",
      loginError?.message ?? "user manquant",
    );
    return null;
  }

  logSuccess("Login DEV réussi pour:", loginData.user.id);
  return loginData.user;
}

async function requestLocationPermissions(): Promise<{
  foregroundGranted: boolean;
  backgroundGranted: boolean;
}> {
  const foreground = await Location.requestForegroundPermissionsAsync();

  if (foreground.status !== "granted") {
    logError("Permission GPS foreground refusée.");
    return {
      foregroundGranted: false,
      backgroundGranted: false,
    };
  }

  let backgroundGranted = false;

  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    backgroundGranted = background.status === "granted";

    if (!backgroundGranted) {
      logInfo(
        "Permission GPS arrière-plan non accordée. Le tracking foreground reste actif.",
      );
    }
  } catch (e) {
    logInfo(
      "Permission background indisponible ou non configurée pour ce build:",
      e,
    );
  }

  return {
    foregroundGranted: true,
    backgroundGranted,
  };
}

async function startKeepAwake(): Promise<void> {
  try {
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    logSuccess("Keep awake activé.");
  } catch (e) {
    logInfo("Keep awake non activé:", e);
  }
}

function stopKeepAwake(): void {
  try {
    deactivateKeepAwake(KEEP_AWAKE_TAG);
    logSuccess("Keep awake désactivé.");
  } catch (e) {
    logInfo("Keep awake non désactivé:", e);
  }
}

async function startForegroundTracking(
  driverId: string,
  intervalMs: number,
): Promise<void> {
  if (locationSubscription) {
    locationSubscription.remove();
    locationSubscription = null;
  }

  locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: intervalMs,
      distanceInterval: 5,
    },
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;

        await sendDriverLocationToSupabase({
          driver_id: driverId,
          lat: latitude,
          lng: longitude,
          updated_at: new Date().toISOString(),
        });
      } catch (e: any) {
        logError("Erreur callback tracking GPS:", e?.message ?? String(e));
      }
    },
  );

  logSuccess(`Tracking foreground démarré (${intervalMs}ms).`);
}

async function startBackgroundTracking(
  driverId: string,
  intervalMs: number,
): Promise<void> {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(
    DRIVER_LOCATION_TASK,
  );

  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
  }

  await Location.startLocationUpdatesAsync(DRIVER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: intervalMs,
    distanceInterval: 10,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService:
      Platform.OS === "android"
        ? {
            notificationTitle: "MMD Delivery actif",
            notificationBody:
              "Votre position chauffeur est partagée pendant que vous êtes en ligne.",
            notificationColor: "#2563EB",
          }
        : undefined,
  });

  logSuccess("Tracking arrière-plan démarré.");
}

async function stopBackgroundTracking(): Promise<void> {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(
    DRIVER_LOCATION_TASK,
  );

  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(DRIVER_LOCATION_TASK);
    logSuccess("Tracking arrière-plan arrêté.");
  }
}

async function updateDriverOnlineStatus(
  driverId: string,
  isOnline: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("driver_profiles")
    .update({ is_online: isOnline })
    .eq("user_id", driverId);

  if (error) {
    logError(
      `Erreur mise à jour driver_profiles.is_online (${isOnline}):`,
      error,
    );
    return;
  }

  logSuccess(
    `driver_profiles.is_online mis à ${isOnline ? "TRUE" : "FALSE"} pour`,
    driverId,
  );
}

function subscribeAppStateForKeepAwake(): void {
  if (appStateSubscription) return;

  appStateSubscription = AppState.addEventListener(
    "change",
    async (state: AppStateStatus) => {
      if (!isTrackingStarted) return;

      if (state === "active") {
        await startKeepAwake();
      }
    },
  );
}

function unsubscribeAppStateForKeepAwake(): void {
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

TaskManager.defineTask(
  DRIVER_LOCATION_TASK,
  async ({
    data,
    error,
  }: {
    data?: {
      locations?: Location.LocationObject[];
    };
    error?: TaskManager.TaskManagerError | null;
  }) => {
    if (error) {
      logError("Erreur task background GPS:", error);
      return;
    }

    const locations = data?.locations ?? [];
    const latestLocation = locations[locations.length - 1];

    if (!latestLocation) return;

    try {
      const user = await getOrLoginDriverUser();

      if (!user) {
        logError("Background GPS: aucun chauffeur connecté.");
        return;
      }

      const { latitude, longitude } = latestLocation.coords;

      await sendDriverLocationToSupabase({
        driver_id: user.id,
        lat: latitude,
        lng: longitude,
        updated_at: new Date().toISOString(),
      });
    } catch (e: any) {
      logError("Erreur background GPS:", e?.message ?? String(e));
    }
  },
);

export async function startDriverLocationTracking(
  options: TrackingOptions = {},
) {
  const intervalMs = options.intervalMs ?? 5000;

  try {
    if (isTrackingStarted) {
      logInfo("Tracking déjà actif, on ne relance pas.");
      return;
    }

    const user = await getOrLoginDriverUser();

    if (!user) {
      logError("Aucun utilisateur chauffeur, tracking annulé.");
      return;
    }

    const driverId = user.id;
    const driverEmail = user.email ?? null;

    logInfo("Driver utilisé pour le tracking:", driverId, "-", driverEmail);

    const permissions = await requestLocationPermissions();

    if (!permissions.foregroundGranted) {
      return;
    }

    await updateDriverOnlineStatus(driverId, true);
    await startKeepAwake();
    subscribeAppStateForKeepAwake();

    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    await sendDriverLocationToSupabase({
      driver_id: driverId,
      lat: current.coords.latitude,
      lng: current.coords.longitude,
      updated_at: new Date().toISOString(),
    });

    await startForegroundTracking(driverId, intervalMs);

    if (permissions.backgroundGranted) {
      await startBackgroundTracking(driverId, intervalMs);
    }

    isTrackingStarted = true;

    logSuccess(
      `Tracking GPS chauffeur démarré pour ${driverId} (intervalle = ${intervalMs}ms)`,
    );
  } catch (e: any) {
    logError("Erreur startDriverLocationTracking:", e?.message ?? String(e));
  }
}

export async function stopDriverLocationTracking() {
  try {
    if (locationSubscription) {
      locationSubscription.remove();
      locationSubscription = null;
    }

    await stopBackgroundTracking();
    stopKeepAwake();
    unsubscribeAppStateForKeepAwake();

    isTrackingStarted = false;

    logSuccess("Tracking GPS arrêté.");

    const user = await getOrLoginDriverUser();

    if (!user) {
      logInfo("stopTracking: aucun user chauffeur disponible.");
      return;
    }

    await updateDriverOnlineStatus(user.id, false);
  } catch (e: any) {
    logError("Erreur stopDriverLocationTracking:", e?.message ?? String(e));
  }
}

export async function isDriverBackgroundTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(
      DRIVER_LOCATION_TASK,
    );
  } catch {
    return false;
  }
}