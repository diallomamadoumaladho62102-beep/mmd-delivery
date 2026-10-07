import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NEARBY_FRESH_MS,
  NEARBY_MAX_ELIGIBILITY_CHECKS,
  NEARBY_MAX_LOCATION_ROWS,
  NEARBY_MAX_RESULTS,
  type NearbyLocationRow,
  type NearbyProfileRow,
  type NearbyPublicResponse,
  clampNearbyRadiusMiles,
  milesBetween,
  nearbyBoundingBox,
  normalizeNearbyCategory,
  passesLocalNearbyRules,
  resolvePrebookingEta,
  toPublicNearbyDriver,
  validateNearbyPickup,
} from "@/lib/nearbyActiveDrivers";

export type NearbyReaders = {
  readLocations: (query: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    freshSince: string;
    limit: number;
  }) => Promise<NearbyLocationRow[]>;
  readProfiles: (driverIds: string[]) => Promise<NearbyProfileRow[]>;
  categoryEligible: (driverId: string, category: string) => Promise<boolean>;
  canReceiveOffer: (driverId: string) => Promise<boolean>;
};

export type NearbyLoadResult =
  | NearbyPublicResponse
  | { ok: false; error: "invalid_pickup" | "invalid_category" };

/**
 * Read-only pre-booking availability. Callers must not create rides, offers,
 * payments, or dispatch rows from this result.
 */
export async function loadNearbyActiveDrivers(input: {
  pickupLat: unknown;
  pickupLng: unknown;
  vehicleClass: unknown;
  radiusMiles?: unknown;
  now?: Date;
  readers: NearbyReaders;
  routeMinutes: (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ) => Promise<number>;
}): Promise<NearbyLoadResult> {
  const pickup = validateNearbyPickup(input.pickupLat, input.pickupLng);
  if (!pickup) return { ok: false, error: "invalid_pickup" };
  const category = normalizeNearbyCategory(input.vehicleClass);
  if (!category) return { ok: false, error: "invalid_category" };

  const radiusMiles = clampNearbyRadiusMiles(input.radiusMiles);
  const now = input.now ?? new Date();
  const box = nearbyBoundingBox(pickup.lat, pickup.lng, radiusMiles);
  const locations = await input.readers.readLocations({
    ...box,
    freshSince: new Date(now.getTime() - NEARBY_FRESH_MS).toISOString(),
    limit: NEARBY_MAX_LOCATION_ROWS,
  });

  const ids = [...new Set(locations.map((row) => String(row.driver_id ?? "")).filter(Boolean))].slice(
    0,
    NEARBY_MAX_LOCATION_ROWS,
  );
  const profiles = ids.length ? await input.readers.readProfiles(ids) : [];
  const profileById = new Map(profiles.map((row) => [row.user_id, row]));

  const ranked = locations
    .map((row) => ({
      row,
      miles: milesBetween(pickup.lat, pickup.lng, Number(row.lat), Number(row.lng)),
    }))
    .filter((item) =>
      passesLocalNearbyRules({
        profile: profileById.get(item.row.driver_id),
        updatedAt: item.row.updated_at,
        miles: item.miles,
        radiusMiles,
        now,
      }),
    )
    .sort((a, b) => a.miles - b.miles)
    .slice(0, NEARBY_MAX_ELIGIBILITY_CHECKS);

  const accepted: Array<{ driverId: string; lat: number; lng: number }> = [];
  for (const item of ranked) {
    if (accepted.length >= NEARBY_MAX_RESULTS) break;
    const driverId = item.row.driver_id;
    const eligible = await input.readers.categoryEligible(driverId, category);
    if (!eligible) continue;
    const available = await input.readers.canReceiveOffer(driverId);
    if (!available) continue;
    accepted.push({
      driverId,
      lat: Number(item.row.lat),
      lng: Number(item.row.lng),
    });
  }

  const drivers = accepted.slice(0, NEARBY_MAX_RESULTS).map((driver) =>
    toPublicNearbyDriver(driver.driverId, driver.lat, driver.lng),
  );
  const nearest = accepted[0] ? { lat: accepted[0].lat, lng: accepted[0].lng } : null;
  const eta = await resolvePrebookingEta(nearest, pickup, input.routeMinutes);

  return {
    ok: true,
    informational: true,
    category,
    radius_miles: radiusMiles,
    drivers,
    eta,
  };
}

export function createNearbyReaders(
  admin: SupabaseClient,
  userClient: SupabaseClient,
): NearbyReaders {
  return {
    async readLocations(query) {
      const { data, error } = await admin
        .from("driver_locations")
        .select("driver_id,lat,lng,updated_at")
        .gte("updated_at", query.freshSince)
        .gte("lat", query.minLat)
        .lte("lat", query.maxLat)
        .gte("lng", query.minLng)
        .lte("lng", query.maxLng)
        .limit(query.limit);
      if (error) throw new Error("nearby_locations_unavailable");
      return (data ?? []) as NearbyLocationRow[];
    },
    async readProfiles(driverIds) {
      const { data: driverProfiles, error: driverError } = await admin
        .from("driver_profiles")
        .select("user_id,is_online,status")
        .in("user_id", driverIds);
      if (driverError) throw new Error("nearby_profiles_unavailable");
      const { data: accounts, error: accountError } = await admin
        .from("profiles")
        .select("id,account_status")
        .in("id", driverIds);
      if (accountError) throw new Error("nearby_accounts_unavailable");
      const accountById = new Map(
        (accounts ?? []).map((row) => [String((row as { id: string }).id), row as { account_status?: string }]),
      );
      return (driverProfiles ?? []).map((row) => {
        const profile = row as { user_id: string; is_online: boolean; status: string };
        const account = accountById.get(profile.user_id);
        const status = String(profile.status ?? "").trim().toLowerCase();
        const accountStatus = String(account?.account_status ?? "").trim().toLowerCase();
        return {
          user_id: profile.user_id,
          is_online: profile.is_online === true,
          status: profile.status,
          account_status: account?.account_status ?? "",
          is_test: status === "test" || accountStatus === "test",
          archived: status === "archived" || accountStatus === "archived",
        };
      });
    },
    async categoryEligible(driverId, category) {
      const { data, error } = await userClient.rpc("is_taxi_driver_eligible", {
        p_user_id: driverId,
        p_vehicle_class: category,
        p_require_premium_driver: false,
      });
      return !error && data === true;
    },
    async canReceiveOffer(driverId) {
      const { data, error } = await userClient.rpc("taxi_driver_can_receive_offer", {
        p_user_id: driverId,
      });
      return !error && data === true;
    },
  };
}
