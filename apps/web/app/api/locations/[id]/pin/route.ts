import { NextRequest } from "next/server";
import {
  computeLocationConfidenceScore,
  fetchOwnedLocationPoint,
  mmdLocationJson,
  normalizeLocationSource,
  parseCoordinate,
  parseUuid,
  requireMmdLocationApiUser,
  type LocationPointRow,
} from "@/lib/mmdLocationCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdatePinBody = {
  pin_lat?: number;
  pin_lng?: number;
  accuracy_m?: number;
  location_source?: string;
  geocoded_lat?: number;
  geocoded_lng?: number;
};

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  const { id: rawId } = await context.params;
  let locationId: string;
  try {
    locationId = parseUuid(rawId, "location id");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid location id";
    return mmdLocationJson({ error: message }, 400);
  }

  let body: UpdatePinBody;
  try {
    body = (await req.json()) as UpdatePinBody;
  } catch {
    return mmdLocationJson({ error: "Invalid JSON" }, 400);
  }

  const owned = await fetchOwnedLocationPoint({
    supabaseAdmin: auth.supabaseAdmin,
    locationId,
    userId: auth.user.id,
  });

  if (owned.error) {
    return mmdLocationJson({ error: owned.error }, 500);
  }

  if (owned.forbidden) {
    return mmdLocationJson({ error: "Forbidden" }, 403);
  }

  if (!owned.row) {
    return mmdLocationJson({ error: "Location not found" }, 404);
  }

  try {
    const pinLat =
      body.pin_lat != null
        ? parseCoordinate(body.pin_lat, "pin_lat", -90, 90)
        : owned.row.pin_lat;
    const pinLng =
      body.pin_lng != null
        ? parseCoordinate(body.pin_lng, "pin_lng", -180, 180)
        : owned.row.pin_lng;

    const geocodedLat =
      body.geocoded_lat != null
        ? parseCoordinate(body.geocoded_lat, "geocoded_lat", -90, 90)
        : owned.row.geocoded_lat;
    const geocodedLng =
      body.geocoded_lng != null
        ? parseCoordinate(body.geocoded_lng, "geocoded_lng", -180, 180)
        : owned.row.geocoded_lng;

    const accuracyM =
      body.accuracy_m != null && Number.isFinite(Number(body.accuracy_m))
        ? Number(body.accuracy_m)
        : owned.row.accuracy_m;

    const locationSource = body.location_source
      ? normalizeLocationSource(body.location_source)
      : owned.row.location_source;

    const confidenceScore = computeLocationConfidenceScore({
      directionsText: owned.row.directions_text,
      pinLat,
      pinLng,
      accuracyM,
      primaryLandmarkId: owned.row.primary_landmark_id,
      locationPhotoPath: owned.row.location_photo_path,
    });

    const { data, error } = await auth.supabaseUser
      .from("location_points")
      .update({
        pin_lat: pinLat,
        pin_lng: pinLng,
        geocoded_lat: geocodedLat,
        geocoded_lng: geocodedLng,
        accuracy_m: accuracyM,
        location_source: locationSource,
        confidence_score: confidenceScore,
      })
      .eq("id", locationId)
      .eq("owner_user_id", auth.user.id)
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
