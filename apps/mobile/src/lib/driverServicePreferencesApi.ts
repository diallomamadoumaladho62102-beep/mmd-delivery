import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

const PREFS_CACHE_KEY = "mmd.driver.service_preferences.v1";
const VEHICLE_CACHE_KEY = "mmd.driver.vehicle_snapshot.v1";

export type DriverServicePreferences = {
  food_delivery_enabled: boolean;
  package_delivery_enabled: boolean;
  taxi_rides_enabled: boolean;
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
    const err = new Error(String(body.message ?? body.error ?? `Request failed (${res.status})`));
    (err as Error & { code?: string }).code = String(body.error ?? "");
    throw err;
  }
  return body;
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
      return JSON.parse(cached) as {
        preferences: DriverServicePreferences;
        has_any_enabled: boolean;
      };
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

export type TaxiCategoryAvailability = {
  category: string;
  label: string;
  available: boolean;
  unavailable_message: string | null;
};

export async function fetchTaxiCategoryAvailability(): Promise<TaxiCategoryAvailability[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/taxi/categories/available`, {
    headers: { Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.error ?? "Failed to load taxi categories"));
  }
  return body.categories ?? [];
}

export function hasAnyDriverServiceEnabled(preferences: DriverServicePreferences): boolean {
  return (
    preferences.food_delivery_enabled ||
    preferences.package_delivery_enabled ||
    preferences.taxi_rides_enabled
  );
}
