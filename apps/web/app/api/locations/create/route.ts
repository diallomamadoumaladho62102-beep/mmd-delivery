import { NextRequest } from "next/server";
import {
  computeLocationConfidenceScore,
  mmdLocationJson,
  normalizeCountryCode,
  normalizeLocationSource,
  normalizeOptionalText,
  parseCoordinate,
  parseUuid,
  requireMmdLocationApiUser,
  type LocationPointRow,
} from "@/lib/mmdLocationCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateLocationBody = {
  country_code?: string;
  region_name?: string;
  prefecture_name?: string;
  city_name?: string;
  commune_name?: string;
  quartier_name?: string;
  formatted_address?: string;
  directions_text?: string;
  geocoded_lat?: number;
  geocoded_lng?: number;
  pin_lat?: number;
  pin_lng?: number;
  accuracy_m?: number;
  location_source?: string;
  primary_landmark_id?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  let body: CreateLocationBody;
  try {
    body = (await req.json()) as CreateLocationBody;
  } catch {
    return mmdLocationJson({ error: "Invalid JSON" }, 400);
  }

  try {
    const countryCode = normalizeCountryCode(body.country_code ?? "GN");
    const directionsText = String(body.directions_text ?? "").trim();
    if (directionsText.length < 8) {
      return mmdLocationJson(
        { error: "directions_text is required (minimum 8 characters)" },
        400
      );
    }

    const pinLat = parseCoordinate(body.pin_lat, "pin_lat", -90, 90);
    const pinLng = parseCoordinate(body.pin_lng, "pin_lng", -180, 180);

    const geocodedLat =
      body.geocoded_lat != null
        ? parseCoordinate(body.geocoded_lat, "geocoded_lat", -90, 90)
        : null;
    const geocodedLng =
      body.geocoded_lng != null
        ? parseCoordinate(body.geocoded_lng, "geocoded_lng", -180, 180)
        : null;

    const accuracyM =
      body.accuracy_m != null && Number.isFinite(Number(body.accuracy_m))
        ? Number(body.accuracy_m)
        : null;

    const locationSource = normalizeLocationSource(body.location_source);
    const primaryLandmarkId = body.primary_landmark_id
      ? parseUuid(body.primary_landmark_id, "primary_landmark_id")
      : null;

    if (primaryLandmarkId) {
      const { data: landmark, error: landmarkError } = await auth.supabaseAdmin
        .from("location_landmarks")
        .select("id, status, country_code")
        .eq("id", primaryLandmarkId)
        .maybeSingle();

      if (landmarkError) {
        return mmdLocationJson({ error: landmarkError.message }, 500);
      }

      if (!landmark || landmark.status !== "approved") {
        return mmdLocationJson({ error: "Landmark not found or not approved" }, 400);
      }

      if (String(landmark.country_code).toUpperCase() !== countryCode) {
        return mmdLocationJson({ error: "Landmark country mismatch" }, 400);
      }
    }

    const confidenceScore = computeLocationConfidenceScore({
      directionsText,
      pinLat,
      pinLng,
      accuracyM,
      primaryLandmarkId,
      locationPhotoPath: null,
    });

    const insertRow = {
      owner_user_id: auth.user.id,
      country_code: countryCode,
      region_name: normalizeOptionalText(body.region_name),
      prefecture_name: normalizeOptionalText(body.prefecture_name),
      city_name: normalizeOptionalText(body.city_name),
      commune_name: normalizeOptionalText(body.commune_name),
      quartier_name: normalizeOptionalText(body.quartier_name),
      formatted_address: normalizeOptionalText(body.formatted_address),
      directions_text: directionsText,
      geocoded_lat: geocodedLat,
      geocoded_lng: geocodedLng,
      pin_lat: pinLat,
      pin_lng: pinLng,
      accuracy_m: accuracyM,
      location_source: locationSource,
      primary_landmark_id: primaryLandmarkId,
      confidence_score: confidenceScore,
    };

    const { data, error } = await auth.supabaseUser
      .from("location_points")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      return mmdLocationJson({ error: error.message }, 500);
    }

    return mmdLocationJson({
      ok: true,
      location: data as LocationPointRow,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return mmdLocationJson({ error: message }, 400);
  }
}
