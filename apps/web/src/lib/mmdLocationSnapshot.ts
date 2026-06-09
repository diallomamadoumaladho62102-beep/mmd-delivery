import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseUuid,
  type LocationPointRow,
} from "@/lib/mmdLocationCore";

export type LocationLandmarkSummary = {
  id: string;
  name: string;
  landmark_type: string;
  lat: number;
  lng: number;
  commune_name: string | null;
  quartier_name: string | null;
};

export type LocationTripView = {
  id: string;
  country_code: string;
  region_name: string | null;
  prefecture_name: string | null;
  city_name: string | null;
  commune_name: string | null;
  quartier_name: string | null;
  formatted_address: string | null;
  directions_text: string;
  pin_lat: number;
  pin_lng: number;
  geocoded_lat: number | null;
  geocoded_lng: number | null;
  accuracy_m: number | null;
  location_source: string;
  confidence_score: number;
  address: string;
  landmark: LocationLandmarkSummary | null;
  photo_path: string | null;
  photo_url: string | null;
};

export type LocationRouteSnapshot = {
  locationId: string;
  lat: number;
  lng: number;
  address: string;
  directionsText: string;
};

export function buildAddressFromLocationPoint(row: {
  formatted_address?: string | null;
  directions_text?: string | null;
  pin_lat?: number | null;
  pin_lng?: number | null;
}): string {
  const formatted = String(row.formatted_address ?? "").trim();
  if (formatted) return formatted;

  const directions = String(row.directions_text ?? "").trim();
  if (directions) return directions.slice(0, 240);

  const lat = Number(row.pin_lat);
  const lng = Number(row.pin_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  return "Pinned location";
}

export async function loadLocationPointById(
  supabaseAdmin: SupabaseClient,
  locationId: string
): Promise<LocationPointRow | null> {
  const { data, error } = await supabaseAdmin
    .from("location_points")
    .select("*")
    .eq("id", locationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as LocationPointRow | null) ?? null;
}

export async function loadOwnedLocationPoint(
  supabaseAdmin: SupabaseClient,
  locationId: string,
  ownerUserId: string
): Promise<
  | { ok: true; row: LocationPointRow }
  | { ok: false; status: number; error: string }
> {
  let parsedId: string;
  try {
    parsedId = parseUuid(locationId, "location_id");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid location_id";
    return { ok: false, status: 400, error: message };
  }

  const row = await loadLocationPointById(supabaseAdmin, parsedId);
  if (!row) {
    return { ok: false, status: 404, error: "Location not found" };
  }

  if (String(row.owner_user_id) !== ownerUserId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, row };
}

export async function driverCanReadLocationPoint(
  supabaseAdmin: SupabaseClient,
  locationId: string,
  driverUserId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("driver_can_read_location_point", {
    p_location_id: locationId,
    p_user_id: driverUserId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data === true;
}

export async function loadLandmarkSummary(
  supabaseAdmin: SupabaseClient,
  landmarkId: string | null
): Promise<LocationLandmarkSummary | null> {
  if (!landmarkId) return null;

  const { data, error } = await supabaseAdmin
    .from("location_landmarks")
    .select(
      "id, name, landmark_type, lat, lng, commune_name, quartier_name"
    )
    .eq("id", landmarkId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  return data as LocationLandmarkSummary;
}

export async function createLocationPhotoSignedUrl(
  supabaseAdmin: SupabaseClient,
  photoPath: string | null,
  expiresInSeconds = 3600
): Promise<string | null> {
  const path = String(photoPath ?? "").trim();
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from("location-attachments")
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function buildLocationTripView(
  supabaseAdmin: SupabaseClient,
  row: LocationPointRow
): Promise<LocationTripView> {
  const landmark = await loadLandmarkSummary(
    supabaseAdmin,
    row.primary_landmark_id
  );
  const photoUrl = await createLocationPhotoSignedUrl(
    supabaseAdmin,
    row.location_photo_path
  );

  return {
    id: row.id,
    country_code: row.country_code,
    region_name: row.region_name,
    prefecture_name: row.prefecture_name,
    city_name: row.city_name,
    commune_name: row.commune_name,
    quartier_name: row.quartier_name,
    formatted_address: row.formatted_address,
    directions_text: row.directions_text,
    pin_lat: row.pin_lat,
    pin_lng: row.pin_lng,
    geocoded_lat: row.geocoded_lat,
    geocoded_lng: row.geocoded_lng,
    accuracy_m: row.accuracy_m,
    location_source: row.location_source,
    confidence_score: row.confidence_score,
    address: buildAddressFromLocationPoint(row),
    landmark,
    photo_path: row.location_photo_path,
    photo_url: photoUrl,
  };
}

export function toLocationRouteSnapshot(row: LocationPointRow): LocationRouteSnapshot {
  return {
    locationId: row.id,
    lat: row.pin_lat,
    lng: row.pin_lng,
    address: buildAddressFromLocationPoint(row),
    directionsText: row.directions_text,
  };
}

export async function applyOwnedLocationIdsToTaxiInput(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  pickupLocationId?: unknown;
  dropoffLocationId?: unknown;
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
}): Promise<
  | {
      ok: true;
      pickupLocationId: string | null;
      dropoffLocationId: string | null;
      pickupAddress?: string;
      dropoffAddress?: string;
      pickupLat?: number;
      pickupLng?: number;
      dropoffLat?: number;
      dropoffLng?: number;
    }
  | { ok: false; status: number; error: string }
> {
  let pickupLocationId: string | null = null;
  let dropoffLocationId: string | null = null;

  let pickupAddress = params.pickupAddress;
  let dropoffAddress = params.dropoffAddress;
  let pickupLat = params.pickupLat;
  let pickupLng = params.pickupLng;
  let dropoffLat = params.dropoffLat;
  let dropoffLng = params.dropoffLng;

  const rawPickupId = String(
    params.pickupLocationId ?? ""
  ).trim();
  if (rawPickupId) {
    const owned = await loadOwnedLocationPoint(
      params.supabaseAdmin,
      rawPickupId,
      params.userId
    );
    if (owned.ok === false) {
      return owned;
    }
    pickupLocationId = owned.row.id;
    const snapshot = toLocationRouteSnapshot(owned.row);
    pickupLat = snapshot.lat;
    pickupLng = snapshot.lng;
    pickupAddress = snapshot.address;
  }

  const rawDropoffId = String(
    params.dropoffLocationId ?? ""
  ).trim();
  if (rawDropoffId) {
    const owned = await loadOwnedLocationPoint(
      params.supabaseAdmin,
      rawDropoffId,
      params.userId
    );
    if (owned.ok === false) {
      return owned;
    }
    dropoffLocationId = owned.row.id;
    const snapshot = toLocationRouteSnapshot(owned.row);
    dropoffLat = snapshot.lat;
    dropoffLng = snapshot.lng;
    dropoffAddress = snapshot.address;
  }

  return {
    ok: true,
    pickupLocationId,
    dropoffLocationId,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  };
}
