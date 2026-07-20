import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";
import { logTechnicalError, toUserFacingError } from "./userFacingError";

const PREFS_CACHE_KEY = "mmd.driver.service_preferences.v1";
const VEHICLE_CACHE_KEY = "mmd.driver.vehicle_snapshot.v1";

export type DriverServicePreferences = {
  food_delivery_enabled: boolean;
  package_delivery_enabled: boolean;
  taxi_rides_enabled: boolean;
  accept_also_standard_rides: boolean;
};

export type VehicleCategoryStatus = {
  category: string;
  label: string;
  status: string;
  reason_code?: string | null;
  reason_message?: string | null;
  admin_approved?: boolean;
};

export type DriverVehicleSnapshot = {
  vehicle: Record<string, unknown> | null;
  categories: VehicleCategoryStatus[];
  eligible_categories: string[];
};

async function authFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    logTechnicalError(`driver.api${path}`, body, { status: res.status });
    const err = new Error(
      toUserFacingError(body, "Une action temporairement impossible s'est produite. Veuillez réessayer."),
    );
    (err as Error & { code?: string }).code = String(body.error ?? "");
    throw err;
  }
  return body;
}

export async function changeDriverTransportMode(transportMode: "bike" | "moto" | "car"): Promise<{
  transport_mode: string;
  taxi_auto_disabled: boolean;
}> {
  const body = await authFetch("/api/driver/transport-mode", {
    method: "PATCH",
    body: JSON.stringify({ transport_mode: transportMode }),
  });
  return {
    transport_mode: String(body.transport_mode ?? transportMode),
    taxi_auto_disabled: body.taxi_auto_disabled === true,
  };
}

export async function fetchDriverServicePreferences(): Promise<{
  preferences: DriverServicePreferences;
  has_any_enabled: boolean;
}> {
  try {
    const body = await authFetch("/api/driver/service-preferences");
    const result = {
      preferences: body.preferences as DriverServicePreferences,
      has_any_enabled: Boolean(body.has_any_enabled),
    };
    await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(result));
    return result;
  } catch (error) {
    const cached = await AsyncStorage.getItem(PREFS_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as {
          preferences: DriverServicePreferences;
          has_any_enabled: boolean;
        };
      } catch {
        // Corrupt cache — drop it and surface the original network error.
        await AsyncStorage.removeItem(PREFS_CACHE_KEY).catch(() => {});
      }
    }
    throw error;
  }
}

export async function updateDriverServicePreferences(
  patch: Partial<DriverServicePreferences>,
): Promise<DriverServicePreferences> {
  const body = await authFetch("/api/driver/service-preferences", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const preferences = body.preferences as DriverServicePreferences;
  await AsyncStorage.setItem(
    PREFS_CACHE_KEY,
    JSON.stringify({
      preferences,
      has_any_enabled: hasAnyDriverServiceEnabled(preferences),
    }),
  );
  return preferences;
}

export async function fetchDriverVehicleSnapshot(): Promise<DriverVehicleSnapshot> {
  try {
    const body = await authFetch("/api/driver/vehicle");
    const snapshot = {
      vehicle: body.vehicle ?? null,
      categories: body.categories ?? [],
      eligible_categories: body.eligible_categories ?? [],
    };
    await AsyncStorage.setItem(VEHICLE_CACHE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch (error) {
    const cached = await AsyncStorage.getItem(VEHICLE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as DriverVehicleSnapshot;
    }
    throw error;
  }
}

export async function updateDriverVehicle(
  patch: Record<string, unknown>,
): Promise<DriverVehicleSnapshot> {
  const body = await authFetch("/api/driver/vehicle", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const snapshot = {
    vehicle: body.vehicle ?? null,
    categories: body.categories ?? [],
    eligible_categories: body.eligible_categories ?? [],
  };
  await AsyncStorage.setItem(VEHICLE_CACHE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function requestDriverVehicleReview(): Promise<void> {
  await authFetch("/api/driver/vehicle", { method: "POST" });
}

export async function fetchDriverCapabilities(): Promise<{ non_smoking: boolean }> {
  const body = await authFetch("/api/driver/capabilities");
  return { non_smoking: Boolean(body.non_smoking) };
}

export async function updateDriverCapabilities(
  patch: Record<string, unknown>,
): Promise<{ non_smoking: boolean }> {
  const body = await authFetch("/api/driver/capabilities", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return { non_smoking: Boolean(body.non_smoking) };
}

export type DriverVehicleListItem = {
  id: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  license_plate: string | null;
  fuel_type: string;
  vehicle_status: string;
  nickname: string | null;
  categories: VehicleCategoryStatus[];
  eligible_categories: string[];
  is_active: boolean;
  inspection_status: string;
  insurance_status: string;
  registration_status: string;
  admin_review_status: string;
  admin_review_notes: string | null;
};

export type DriverVehicleHistoryRow = {
  id: string;
  action: string;
  vehicle_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function fetchDriverVehiclesList(): Promise<{
  vehicles: DriverVehicleListItem[];
  active_vehicle_id: string | null;
  is_online: boolean;
  history: DriverVehicleHistoryRow[];
}> {
  const body = await authFetch("/api/driver/vehicles");
  return {
    vehicles: body.vehicles ?? [],
    active_vehicle_id: body.active_vehicle_id ?? null,
    is_online: Boolean(body.is_online),
    history: body.history ?? [],
  };
}

export async function addDriverVehicle(patch: Record<string, unknown>): Promise<void> {
  await authFetch("/api/driver/vehicles", {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function fetchDriverVehicleById(vehicleId: string): Promise<{
  vehicle: Record<string, unknown> | null;
  categories: VehicleCategoryStatus[];
}> {
  const body = await authFetch(`/api/driver/vehicles/${vehicleId}`);
  return {
    vehicle: body.vehicle ?? null,
    categories: body.categories ?? [],
  };
}

export async function updateDriverVehicleById(
  vehicleId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await authFetch(`/api/driver/vehicles/${vehicleId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteDriverVehicle(vehicleId: string): Promise<void> {
  await authFetch(`/api/driver/vehicles/${vehicleId}`, { method: "DELETE" });
}

export async function setDriverActiveVehicle(vehicleId: string): Promise<string> {
  const body = await authFetch("/api/driver/vehicles/active", {
    method: "POST",
    body: JSON.stringify({ vehicle_id: vehicleId }),
  });
  return String(body.active_vehicle_id ?? vehicleId);
}

export async function setDriverOnlineViaApi(isOnline: boolean): Promise<boolean> {
  // Prefer DB RPC so ONLINE works even when the store build still expects a
  // client-side write (self-write guard no longer freezes is_online).
  const { data, error } = await supabase.rpc("set_driver_online", {
    p_online: isOnline,
  });

  if (!error && data && typeof data === "object") {
    const row = data as {
      ok?: boolean;
      is_online?: boolean;
      error?: string;
      message?: string;
    };
    if (row.ok === true) {
      return row.is_online === true;
    }
    if (row.ok === false) {
      const err = new Error(
        toUserFacingError(
          { error: row.error, message: row.message },
          "Impossible de changer le statut pour le moment.",
        ),
      );
      (err as Error & { code?: string }).code = String(row.error ?? "");
      throw err;
    }
  }

  // Fallback HTTP API (older schemas without the RPC).
  if (error) {
    logTechnicalError("driver.online.rpc", error, { isOnline });
  }

  const body = await authFetch("/api/driver/online", {
    method: "PATCH",
    body: JSON.stringify({ is_online: isOnline }),
  });
  if (Boolean(body.is_online) === Boolean(isOnline)) {
    return body.is_online === true;
  }

  const status = await fetchDriverOnlineStatus();
  return status.is_online === true;
}

export async function fetchDriverOnlineStatus(): Promise<{
  is_online: boolean;
  status: string | null;
  transport_mode: string | null;
  active_vehicle_id: string | null;
}> {
  const body = await authFetch("/api/driver/online");
  return {
    is_online: body.is_online === true,
    status: body.status ?? null,
    transport_mode: body.transport_mode ?? null,
    active_vehicle_id: body.active_vehicle_id ?? null,
  };
}

export type TaxiCategoryAvailability = {
  category: string;
  label: string;
  available: boolean;
  unavailable_message: string | null;
};

export async function fetchTaxiCategoryAvailability(): Promise<TaxiCategoryAvailability[]> {
  const body = await authFetch("/api/taxi/categories/available");
  return body.categories ?? [];
}

export function hasAnyDriverServiceEnabled(preferences: DriverServicePreferences): boolean {
  return (
    preferences.food_delivery_enabled ||
    preferences.package_delivery_enabled ||
    preferences.taxi_rides_enabled
  );
}
