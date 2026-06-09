import { NextRequest } from "next/server";
import {
  buildLocationPhotoPath,
  computeLocationConfidenceScore,
  extensionFromContentType,
  fetchOwnedLocationPoint,
  mmdLocationJson,
  parseUuid,
  requireMmdLocationApiUser,
  type LocationPointRow,
} from "@/lib/mmdLocationCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type PhotoBody = {
  image_base64?: string;
  content_type?: string;
};

function decodeBase64Image(raw: string): Buffer {
  const normalized = raw.includes(",") ? raw.split(",").pop() ?? "" : raw;
  const buffer = Buffer.from(normalized, "base64");
  if (!buffer.length) {
    throw new Error("Invalid image_base64");
  }
  return buffer;
}

export async function POST(
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

  let body: PhotoBody;
  try {
    body = (await req.json()) as PhotoBody;
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
    const imageBase64 = String(body.image_base64 ?? "").trim();
    if (!imageBase64) {
      return mmdLocationJson({ error: "image_base64 is required" }, 400);
    }

    const contentType = String(body.content_type ?? "image/jpeg").trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      return mmdLocationJson({ error: "content_type must be an image type" }, 400);
    }

    const buffer = decodeBase64Image(imageBase64);
    if (buffer.length > MAX_PHOTO_BYTES) {
      return mmdLocationJson({ error: "Image exceeds 5 MB limit" }, 400);
    }

    const ext = extensionFromContentType(contentType);
    const photoPath = buildLocationPhotoPath({
      ownerUserId: auth.user.id,
      locationId,
      ext,
    });

    const { error: uploadError } = await auth.supabaseAdmin.storage
      .from("location-attachments")
      .upload(photoPath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      return mmdLocationJson({ error: uploadError.message }, 500);
    }

    const confidenceScore = computeLocationConfidenceScore({
      directionsText: owned.row.directions_text,
      pinLat: owned.row.pin_lat,
      pinLng: owned.row.pin_lng,
      accuracyM: owned.row.accuracy_m,
      primaryLandmarkId: owned.row.primary_landmark_id,
      locationPhotoPath: photoPath,
    });

    const { data, error } = await auth.supabaseUser
      .from("location_points")
      .update({
        location_photo_path: photoPath,
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
      photo_path: photoPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return mmdLocationJson({ error: message }, 400);
  }
}
