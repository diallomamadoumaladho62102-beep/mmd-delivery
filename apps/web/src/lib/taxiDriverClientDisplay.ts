import { resolvePublicAvatarUrl } from "./adminFoodOrderDisplay";

export type TaxiDriverClientDisplay = {
  full_name: string | null;
  avatar_url: string | null;
};

const ACTIVE_TAXI_STATUSES = new Set([
  "accepted",
  "driver_arrived",
  "in_progress",
]);

/**
 * Build client display fields for an assigned taxi driver.
 * Call only after the ride row is already scoped to driver_id = auth user.
 * Never invents photo URLs; resolves storage paths to public avatar URLs.
 */
export function buildTaxiDriverClientDisplay(params: {
  rideStatus: string | null | undefined;
  driverId: string | null | undefined;
  viewerDriverId: string | null | undefined;
  clientUserId: string | null | undefined;
  profile: { full_name?: string | null; avatar_url?: string | null } | null;
}): TaxiDriverClientDisplay | null {
  const status = String(params.rideStatus ?? "")
    .trim()
    .toLowerCase();
  if (!ACTIVE_TAXI_STATUSES.has(status)) return null;

  const driverId = String(params.driverId ?? "").trim();
  const viewerId = String(params.viewerDriverId ?? "").trim();
  const clientId = String(params.clientUserId ?? "").trim();
  if (!driverId || !viewerId || !clientId) return null;
  if (driverId !== viewerId) return null;

  const name = String(params.profile?.full_name ?? "").trim() || null;
  const avatar = resolvePublicAvatarUrl(params.profile?.avatar_url ?? null);

  return {
    full_name: name,
    avatar_url: avatar,
  };
}

/**
 * Meeting-point coords for the map: use ride pickup only (never invent live GPS).
 * Rejects null/NaN/0,0 and out-of-range values.
 */
export function resolveTaxiClientMeetingPoint(params: {
  stage: "pickup" | "dropoff";
  pickupLat: unknown;
  pickupLng: unknown;
}): { latitude: number; longitude: number } | null {
  if (params.stage !== "pickup") return null;
  if (params.pickupLat == null || params.pickupLng == null) return null;
  if (params.pickupLat === "" || params.pickupLng === "") return null;
  const lat = Number(params.pickupLat);
  const lng = Number(params.pickupLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}
