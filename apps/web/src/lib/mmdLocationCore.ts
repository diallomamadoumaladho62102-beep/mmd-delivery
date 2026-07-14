import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export const LANDMARK_TYPES = [
  "mosque",
  "church",
  "school",
  "market",
  "fuel_station",
  "bank",
  "hotel",
  "roundabout",
  "bridge",
  "mobile_money",
  "other",
] as const;

export const LOCATION_SOURCES = [
  "gps",
  "pin",
  "landmark",
  "saved",
  "community",
] as const;

export type LandmarkType = (typeof LANDMARK_TYPES)[number];
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export type LocationPointRow = {
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
  location_source: LocationSource;
  primary_landmark_id: string | null;
  location_photo_path: string | null;
  confidence_score: number;
  created_at: string;
  updated_at: string;
};

export function mmdLocationJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function getBearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export function parseUuid(value: unknown, label: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`Missing ${label}`);
  if (!UUID_RE.test(raw)) throw new Error(`Invalid ${label}`);
  return raw;
}

export function parseCoordinate(
  value: unknown,
  label: string,
  min: number,
  max: number
): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`Invalid ${label}`);
  }
  return num;
}

export function normalizeCountryCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error("Invalid country_code");
  }
  return code;
}

export function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function normalizeLocationSource(value: unknown): LocationSource {
  const source = String(value ?? "pin").trim().toLowerCase();
  if (!(LOCATION_SOURCES as readonly string[]).includes(source)) {
    throw new Error("Invalid location_source");
  }
  return source as LocationSource;
}

export function computeLocationConfidenceScore(input: {
  directionsText: string;
  pinLat: number;
  pinLng: number;
  accuracyM: number | null;
  primaryLandmarkId: string | null;
  locationPhotoPath: string | null;
}): number {
  let score = 20;

  if (input.directionsText.trim().length >= 20) score += 25;
  else if (input.directionsText.trim().length >= 8) score += 15;

  if (Number.isFinite(input.pinLat) && Number.isFinite(input.pinLng)) {
    score += 25;
  }

  if (input.accuracyM != null && input.accuracyM <= 30) score += 15;
  else if (input.accuracyM != null && input.accuracyM <= 80) score += 8;

  if (input.primaryLandmarkId) score += 10;
  if (input.locationPhotoPath) score += 10;

  return Math.min(100, Math.max(0, score));
}

export function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

export type MmdLocationAuthSuccess = {
  ok: true;
  user: User;
  token: string;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
};

export type MmdLocationAuthFailure = {
  ok: false;
  response: NextResponse;
};

export async function requireMmdLocationApiUser(
  req: NextRequest
): Promise<MmdLocationAuthSuccess | MmdLocationAuthFailure> {
  const token = getBearerToken(req);
  if (!token) {
    return {
      ok: false,
      response: mmdLocationJson({ error: "Missing Authorization Bearer token" }, 401),
    };
  }

  const supabaseUser = getSupabaseUserClient(token);
  const supabaseAdmin = getSupabaseAdminClient();

  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;

  if (error || !user?.id) {
    return { ok: false, response: mmdLocationJson({ error: "Invalid token" }, 401) };
  }

  return { ok: true, user, token, supabaseUser, supabaseAdmin };
}

export function buildLocationPhotoPath(params: {
  ownerUserId: string;
  locationId: string;
  ext: string;
}): string {
  return `${params.ownerUserId}/${params.locationId}/location.${params.ext}`;
}

export function extensionFromContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  return "jpg";
}

export async function fetchOwnedLocationPoint(params: {
  supabaseAdmin: SupabaseClient;
  locationId: string;
  userId: string;
}): Promise<{ row: LocationPointRow | null; forbidden: boolean; error?: string }> {
  const { data, error } = await params.supabaseAdmin
    .from("location_points")
    .select("*")
    .eq("id", params.locationId)
    .maybeSingle();

  if (error) {
    return { row: null, forbidden: false, error: error.message };
  }

  if (!data) {
    return { row: null, forbidden: false };
  }

  if (String(data.owner_user_id) !== params.userId) {
    return { row: null, forbidden: true };
  }

  return { row: data as LocationPointRow, forbidden: false };
}
