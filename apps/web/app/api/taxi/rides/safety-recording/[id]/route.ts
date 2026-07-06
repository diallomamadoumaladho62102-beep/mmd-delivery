import { NextRequest } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id } = await context.params;
    const recordingId = String(id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) {
      return taxiJson({ ok: false, error: "invalid_recording_id" }, 400);
    }

    const { data: recording, error } = await auth.supabaseAdmin
      .from("ride_safety_recordings")
      .select("*")
      .eq("id", recordingId)
      .maybeSingle();

    if (error) return taxiJson({ ok: false, error: error.message }, 500);
    if (!recording) return taxiJson({ ok: false, error: "recording_not_found" }, 404);

    const { data: ride } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("client_user_id,driver_id")
      .eq("id", recording.taxi_ride_id)
      .maybeSingle();

    const userId = auth.user.id;
    const allowed =
      String(recording.initiator_user_id) === userId ||
      String(ride?.client_user_id) === userId ||
      String(ride?.driver_id ?? "") === userId;

    if (!allowed) return taxiJson({ ok: false, error: "forbidden" }, 403);

    if (!["available", "locked_for_review"].includes(String(recording.status))) {
      return taxiJson({ ok: false, error: "not_available" }, 400);
    }

    const storagePath = String(recording.storage_path ?? "").trim();
    if (!storagePath) return taxiJson({ ok: false, error: "missing_storage_path" }, 400);

    await auth.supabaseUser.rpc("audit_ride_safety_recording_access", {
      p_recording_id: recordingId,
      p_event_type: "download",
    });

    const { data: signed, error: signError } = await auth.supabaseAdmin.storage
      .from(String(recording.storage_bucket ?? "ride-safety-recordings"))
      .createSignedUrl(storagePath, 60 * 30);

    if (signError || !signed?.signedUrl) {
      return taxiJson({ ok: false, error: signError?.message ?? "signed_url_failed" }, 500);
    }

    return taxiJson({
      ok: true,
      download_url: signed.signedUrl,
      expires_in_seconds: 60 * 30,
      recording_id: recordingId,
    });
  } catch (e: unknown) {
    return taxiJson({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", req);
    const supabaseAdmin = buildSupabaseAdminClient();
    const { id } = await context.params;
    const recordingId = String(id ?? "").trim();
    const body = await req.json().catch(() => ({}));

    const { data, error } = await supabaseAdmin.rpc("lock_ride_safety_recording_for_review", {
        p_recording_id: recordingId,
        p_reason: body.reason ?? null,
        p_incident_id: body.incident_id ?? null,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) return taxiJson({ ok: false, ...result }, 400);

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "ride_safety_recording_locked",
      targetType: "ride_safety_recording",
      targetId: recordingId,
      metadata: { reason: body.reason ?? null },
      request: req,
    });

    return taxiJson({ ok: true, recording: result.recording });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status,
    );
  }
}
