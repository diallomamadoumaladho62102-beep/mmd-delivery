import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { resolveSafetyRecordingUpload } from "@/lib/uploadSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    const recordingId = String(body.recording_id ?? body.recordingId ?? "").trim();
    const clientPath = String(body.storage_path ?? body.storagePath ?? "").trim();
    const fileSizeBytes = Number(body.file_size_bytes ?? body.fileSizeBytes ?? 0);
    const mimeType = String(body.mime_type ?? body.mimeType ?? "").trim();
    const extension = String(body.extension ?? "").trim();

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

    const resolved = resolveSafetyRecordingUpload({
      rideId: String(existing.taxi_ride_id),
      recordingId,
      clientPath: clientPath || null,
      mimeType,
      extension,
      fileSizeBytes,
    });

    if (resolved.ok === false) {
      return taxiJson({ ok: false, error: resolved.error }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("complete_ride_safety_recording_upload", {
      p_recording_id: recordingId,
      p_storage_path: resolved.storagePath,
      p_file_size_bytes: resolved.fileSizeBytes,
      p_mime_type: resolved.mimeType,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    return taxiJson({
      ok: true,
      recording: result.recording,
      storage_path: resolved.storagePath,
    });
  } catch (e: unknown) {
    return taxiJson({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
}
