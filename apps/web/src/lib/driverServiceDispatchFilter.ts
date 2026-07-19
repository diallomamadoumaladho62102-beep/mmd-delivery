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

  return new Set(
    (data ?? [])
      .filter((row) => {
        if (service === "food") return row.food_delivery_enabled === true;
        if (service === "package") return row.package_delivery_enabled === true;
        return row.taxi_rides_enabled === true;
      })
      .map((row) => String(row.driver_user_id ?? ""))
      .filter(Boolean),
  );
}
