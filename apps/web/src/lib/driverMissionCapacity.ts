/**
 * Driver delivery mission capacity helpers for Food + Package + Delivery.
 * Server-side SQL accept RPCs remain the source of truth for race safety;
 * these helpers filter dispatch candidates before offers are created.
 */

import {
  evaluateRouteCompatibility,
  formatStackedDeliveryLabel,
  type ActiveMissionRoute,
  type LatLng,
  type RouteCompatibilitySettings,
  DEFAULT_ROUTE_COMPATIBILITY,
} from "@/lib/routeCompatibility";

export type DriverCapacitySettings = RouteCompatibilitySettings & {
  max_active_delivery_missions: number;
  max_active_taxi_rides: number;
  max_queued_taxi_rides: number;
  next_ride_eta_threshold_minutes: number;
  next_ride_min_eta_minutes: number;
  next_ride_distance_threshold_miles: number;
  next_ride_min_distance_miles: number;
  taxi_next_ride_enabled: boolean;
};

export const DEFAULT_DRIVER_CAPACITY_SETTINGS: DriverCapacitySettings = {
  ...DEFAULT_ROUTE_COMPATIBILITY,
  max_active_delivery_missions: 3,
  max_active_taxi_rides: 1,
  max_queued_taxi_rides: 1,
  next_ride_eta_threshold_minutes: 5,
  next_ride_min_eta_minutes: 1,
  next_ride_distance_threshold_miles: 2,
  next_ride_min_distance_miles: 1,
  taxi_next_ride_enabled: true,
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadDriverCapacitySettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<DriverCapacitySettings> {
  try {
    const { data, error } = await supabase
      .from("driver_capacity_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();

    if (error || !data) {
      return { ...DEFAULT_DRIVER_CAPACITY_SETTINGS };
    }

    return {
      max_active_delivery_missions:
        toNumber(data.max_active_delivery_missions) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_active_delivery_missions,
      max_route_detour_miles:
        toNumber(data.max_route_detour_miles) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_route_detour_miles,
      max_route_detour_minutes:
        toNumber(data.max_route_detour_minutes) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_route_detour_minutes,
      max_added_eta_minutes:
        toNumber(data.max_added_eta_minutes) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_added_eta_minutes,
      route_compatibility_enabled:
        data.route_compatibility_enabled !== false,
      food_hot_priority_enabled: data.food_hot_priority_enabled !== false,
      max_active_taxi_rides:
        toNumber(data.max_active_taxi_rides) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_active_taxi_rides,
      max_queued_taxi_rides:
        toNumber(data.max_queued_taxi_rides) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.max_queued_taxi_rides,
      next_ride_eta_threshold_minutes:
        toNumber(data.next_ride_eta_threshold_minutes) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_eta_threshold_minutes,
      next_ride_min_eta_minutes:
        toNumber(data.next_ride_min_eta_minutes) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_min_eta_minutes,
      next_ride_distance_threshold_miles:
        toNumber(data.next_ride_distance_threshold_miles) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_distance_threshold_miles,
      next_ride_min_distance_miles:
        toNumber(data.next_ride_min_distance_miles) ??
        DEFAULT_DRIVER_CAPACITY_SETTINGS.next_ride_min_distance_miles,
      taxi_next_ride_enabled: data.taxi_next_ride_enabled !== false,
    };
  } catch {
    return { ...DEFAULT_DRIVER_CAPACITY_SETTINGS };
  }
}

export async function getDriverActiveDeliveryMissionCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  driverId: string,
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc(
      "driver_active_delivery_mission_count",
      { p_user_id: driverId },
    );
    if (error) return 0;
    const n = toNumber(data);
    return n != null && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export async function loadDriverActiveMissionRoutes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  driverId: string,
): Promise<ActiveMissionRoute[]> {
  const routes: ActiveMissionRoute[] = [];

  const [ordersRes, drRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,status,kind,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,eta_minutes",
      )
      .eq("driver_id", driverId)
      .eq("is_test", false)
      .is("archived_at", null)
      .neq("hidden_from_user", true)
      .not("status", "in", '("delivered","canceled","cancelled","refunded")')
      .limit(10),
    supabase
      .from("delivery_requests")
      .select(
        "id,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,eta_minutes",
      )
      .eq("driver_id", driverId)
      .eq("is_test", false)
      .is("archived_at", null)
      .neq("hidden_from_user", true)
      .not("status", "in", '("delivered","canceled","cancelled","refunded")')
      .limit(10),
  ]);

  for (const row of ordersRes.data ?? []) {
    const plat = toNumber(row.pickup_lat);
    const plng = toNumber(row.pickup_lng);
    const dlat = toNumber(row.dropoff_lat);
    const dlng = toNumber(row.dropoff_lng);
    routes.push({
      kind: String(row.kind ?? "food").toLowerCase() === "food" ? "food" : "package",
      pickup:
        plat != null && plng != null ? { lat: plat, lng: plng } : null,
      dropoff:
        dlat != null && dlng != null ? { lat: dlat, lng: dlng } : null,
      remainingEtaMinutes: toNumber(row.eta_minutes),
    });
  }

  for (const row of drRes.data ?? []) {
    const plat = toNumber(row.pickup_lat);
    const plng = toNumber(row.pickup_lng);
    const dlat = toNumber(row.dropoff_lat);
    const dlng = toNumber(row.dropoff_lng);
    routes.push({
      kind: "package",
      pickup:
        plat != null && plng != null ? { lat: plat, lng: plng } : null,
      dropoff:
        dlat != null && dlng != null ? { lat: dlat, lng: dlng } : null,
      remainingEtaMinutes: toNumber(row.eta_minutes),
    });
  }

  return routes;
}

export type DeliveryDispatchCandidate = {
  driverId: string;
  distanceMiles: number;
  [key: string]: unknown;
};

export type FilterDeliveryCapacityResult = {
  eligible: DeliveryDispatchCandidate[];
  skippedCapacity: number;
  skippedRoute: number;
  stackMetaByDriver: Map<
    string,
    { stackIndex: number; max: number; label: string; detourMiles?: number }
  >;
};

/**
 * Filter candidates that already have max missions or incompatible routes.
 */
export async function filterDeliveryCandidatesByCapacityAndRoute(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  candidates: DeliveryDispatchCandidate[];
  newPickup: LatLng;
  newDropoff: LatLng | null;
  newKind?: "food" | "package" | "delivery";
  settings?: DriverCapacitySettings;
}): Promise<FilterDeliveryCapacityResult> {
  const settings =
    params.settings ?? (await loadDriverCapacitySettings(params.supabase));
  const max = settings.max_active_delivery_missions;
  const eligible: DeliveryDispatchCandidate[] = [];
  let skippedCapacity = 0;
  let skippedRoute = 0;
  const stackMetaByDriver = new Map<
    string,
    { stackIndex: number; max: number; label: string; detourMiles?: number }
  >();

  for (const candidate of params.candidates) {
    const driverId = String(candidate.driverId);
    const count = await getDriverActiveDeliveryMissionCount(
      params.supabase,
      driverId,
    );

    if (count >= max) {
      skippedCapacity += 1;
      continue;
    }

    const activeMissions = await loadDriverActiveMissionRoutes(
      params.supabase,
      driverId,
    );

    let driverLocation: LatLng | null = null;
    try {
      const { data: loc } = await params.supabase
        .from("driver_locations")
        .select("lat,lng")
        .eq("driver_id", driverId)
        .maybeSingle();
      const lat = toNumber(loc?.lat);
      const lng = toNumber(loc?.lng);
      if (lat != null && lng != null) driverLocation = { lat, lng };
    } catch {
      // ignore
    }

    const compat = evaluateRouteCompatibility({
      driverLocation,
      activeMissions,
      newPickup: params.newPickup,
      newDropoff: params.newDropoff,
      newKind: params.newKind,
      settings,
    });

    if (!compat.ok) {
      skippedRoute += 1;
      continue;
    }

    const stackIndex = count + 1;
    stackMetaByDriver.set(driverId, {
      stackIndex,
      max,
      label: formatStackedDeliveryLabel(stackIndex, max),
      detourMiles: compat.detourMiles,
    });
    eligible.push(candidate);
  }

  return { eligible, skippedCapacity, skippedRoute, stackMetaByDriver };
}

export async function filterTaxiCandidatesByCapacity(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  candidates: DeliveryDispatchCandidate[];
}): Promise<{
  eligible: DeliveryDispatchCandidate[];
  skipped: number;
}> {
  const eligible: DeliveryDispatchCandidate[] = [];
  let skipped = 0;

  for (const candidate of params.candidates) {
    try {
      const { data, error } = await params.supabase.rpc(
        "taxi_driver_can_receive_offer",
        { p_user_id: candidate.driverId },
      );
      if (error || data !== true) {
        skipped += 1;
        continue;
      }
      eligible.push(candidate);
    } catch {
      skipped += 1;
    }
  }

  return { eligible, skipped };
}
