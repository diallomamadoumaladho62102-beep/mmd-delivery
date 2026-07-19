import type { SupabaseClient } from "@supabase/supabase-js";

export type DriverDispatchService = "food" | "package" | "taxi";

export async function filterDriverIdsByServicePreference(
  supabaseAdmin: SupabaseClient,
  driverIds: string[],
  service: DriverDispatchService,
): Promise<Set<string>> {
  if (driverIds.length === 0) return new Set();

  const { data, error } = await supabaseAdmin
    .from("driver_service_preferences")
    .select("driver_user_id, food_delivery_enabled, package_delivery_enabled, taxi_rides_enabled")
    .in("driver_user_id", driverIds);

  if (error) {
    // Fail open: a prefs table outage must not silently suppress all dispatch pushes.
    console.log("driver_service_preferences filter error:", error.message);
    return new Set(driverIds);
  }

  const prefsByDriver = new Map<
    string,
    {
      food_delivery_enabled?: boolean | null;
      package_delivery_enabled?: boolean | null;
      taxi_rides_enabled?: boolean | null;
    }
  >();
  for (const row of data ?? []) {
    const id = String(row.driver_user_id ?? "").trim();
    if (id) prefsByDriver.set(id, row);
  }

  const allowed = new Set<string>();
  for (const driverId of driverIds) {
    const prefs = prefsByDriver.get(driverId);
    // Missing prefs row: allow (opt-out only when explicitly disabled).
    if (!prefs) {
      allowed.add(driverId);
      continue;
    }
    const enabled =
      service === "food"
        ? prefs.food_delivery_enabled === true
        : service === "package"
          ? prefs.package_delivery_enabled === true
          : prefs.taxi_rides_enabled === true;
    if (enabled) allowed.add(driverId);
  }
  return allowed;
}
