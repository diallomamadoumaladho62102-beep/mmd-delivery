import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

export type MmdLandmarkType =
  | "mosque"
  | "church"
  | "school"
  | "market"
  | "fuel_station"
  | "bank"
  | "hotel"
  | "roundabout"
  | "bridge"
  | "mobile_money"
  | "other";

export type MmdLocationSource = "gps" | "pin" | "landmark" | "saved" | "community";

export type MmdLocationPoint = {
  id: string;
  owner_user_id: string;
  country_code: string;
  region_name: string | null;
  prefecture_name: string | null;
  city_name: string | null;
  commune_name: string | null;
  quartier_name: string | null;
  formatted_address: string | null;
  directions_text: string;
  geocoded_lat: number | null;
  geocoded_lng: number | null;
  pin_lat: number;
  pin_lng: number;
  accuracy_m: number | null;
  location_source: MmdLocationSource;
  primary_landmark_id: string | null;
  location_photo_path: string | null;
  confidence_score: number;
  created_at: string;
  updated_at: string;
};

export type MmdLandmark = {
  id: string;
  country_code: string;
  region_name: string | null;
  prefecture_name: string | null;
  city_name: string | null;
  commune_name: string | null;
  quartier_name: string | null;
  name: string;
  landmark_type: MmdLandmarkType;
  lat: number;
  lng: number;
  provider: string;
  status: string;
  confidence_score: number;
};

export type MmdZone = {
  id: string;
  country_code: string;
  region_name: string | null;
  prefecture_name: string | null;
  city_name: string | null;
  commune_name: string | null;
  quartier_name: string | null;
  zone_code: string;
  zone_name: string;
  is_active: boolean;
};

export type CreateMmdLocationInput = {
  country_code?: string;
  region_name?: string;
  prefecture_name?: string;
  city_name?: string;
  commune_name?: string;
  quartier_name?: string;
  formatted_address?: string;
  directions_text: string;
  geocoded_lat?: number | null;
  geocoded_lng?: number | null;
  pin_lat: number;
  pin_lng: number;
  accuracy_m?: number | null;
  location_source?: MmdLocationSource;
  primary_landmark_id?: string | null;
};

async function getAuthHeaders(contentType = "application/json") {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }

  return {
    "Content-Type": contentType,
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

async function locationGet(path: string) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

async function locationPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

async function locationPatch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

export function searchMmdLandmarks(params: {
  country_code?: string;
  q?: string;
  commune_name?: string;
  quartier_name?: string;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params.country_code) query.set("country_code", params.country_code);
  if (params.q) query.set("q", params.q);
  if (params.commune_name) query.set("commune_name", params.commune_name);
  if (params.quartier_name) query.set("quartier_name", params.quartier_name);
  if (params.limit) query.set("limit", String(params.limit));
  return locationGet(`/api/landmarks/search?${query.toString()}`);
}

export function searchMmdZones(params: {
  country_code?: string;
  q?: string;
  region_name?: string;
  commune_name?: string;
  include_inactive?: boolean;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params.country_code) query.set("country_code", params.country_code);
  if (params.q) query.set("q", params.q);
  if (params.region_name) query.set("region_name", params.region_name);
  if (params.commune_name) query.set("commune_name", params.commune_name);
  if (params.include_inactive) query.set("include_inactive", "1");
  if (params.limit) query.set("limit", String(params.limit));
  return locationGet(`/api/zones/search?${query.toString()}`);
}

export async function createMmdLocation(input: CreateMmdLocationInput) {
  const out = await locationPost("/api/locations/create", input as Record<string, unknown>);
  return out?.location as MmdLocationPoint;
}

export async function updateMmdLocationPin(
  locationId: string,
  input: {
    pin_lat: number;
    pin_lng: number;
    accuracy_m?: number | null;
    location_source?: MmdLocationSource;
    geocoded_lat?: number | null;
    geocoded_lng?: number | null;
  }
) {
  const out = await locationPatch(`/api/locations/${locationId}/pin`, input);
  return out?.location as MmdLocationPoint;
}

export async function uploadMmdLocationPhoto(params: {
  locationId: string;
  imageBase64: string;
  contentType?: string;
}) {
  const out = await locationPost(`/api/locations/${params.locationId}/photo`, {
    image_base64: params.imageBase64,
    content_type: params.contentType ?? "image/jpeg",
  });
  return out?.location as MmdLocationPoint;
}

export async function saveMmdLocationWithOptionalPhoto(params: {
  input: CreateMmdLocationInput;
  photo?: { uri: string; mime?: string; base64?: string } | null;
}): Promise<MmdLocationPoint> {
  const location = await createMmdLocation(params.input);

  if (!params.photo) {
    return location;
  }

  let imageBase64 = params.photo.base64 ?? "";
  if (!imageBase64 && params.photo.uri) {
    const FileSystem = await import("expo-file-system");
    imageBase64 = await FileSystem.readAsStringAsync(params.photo.uri, {
      encoding: "base64",
    });
  }

  if (!imageBase64) {
    return location;
  }

  return uploadMmdLocationPhoto({
    locationId: location.id,
    imageBase64,
    contentType: params.photo.mime ?? "image/jpeg",
  });
}
