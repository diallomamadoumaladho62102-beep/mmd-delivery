import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildSafetyRecordingStoragePath } from "@/lib/rideSafetyRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    const recordingId = String(body.recording_id ?? body.recordingId ?? "").trim();
    const storagePath = String(body.storage_path ?? body.storagePath ?? "").trim();
    const fileSizeBytes = Number(body.file_size_bytes ?? body.fileSizeBytes ?? 0);
    const mimeType = String(body.mime_type ?? body.mimeType ?? "application/octet-stream").trim();
    const extension = String(body.extension ?? "bin").trim();

    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) {
      return taxiJson({ ok: false, error: "invalid_recording_id" }, 400);
    }

    const { data: existing } = await auth.supabaseAdmin
      .from("ride_safety_recordings")
      .select("id,taxi_ride_id,initiator_user_id")
      .eq("id", recordingId)
      .maybeSingle();

    if (!existing || String(existing.initiator_user_id) !== auth.user.id) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }

    const finalPath =
      storagePath ||
      buildSafetyRecordingStoragePath({
        rideId: String(existing.taxi_ride_id),
        recordingId,
        extension,
      });

    const { data, error } = await auth.supabaseUser.rpc("complete_ride_safety_recording_upload", {
      p_recording_id: recordingId,
      p_storage_path: finalPath,
      p_file_size_bytes: fileSizeBytes,
      p_mime_type: mimeType,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    return taxiJson({
      ok: true,
      recording: result.recording,
      storage_path: finalPath,
    });
  } catch (e: unknown) {
    return taxiJson({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
}
