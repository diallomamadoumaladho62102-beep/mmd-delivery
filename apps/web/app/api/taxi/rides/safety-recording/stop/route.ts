import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { SAFETY_RECORDING_CONSENT_MESSAGE } from "@/lib/rideSafetyRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    const recordingId = String(body.recording_id ?? body.recordingId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) {
      return taxiJson({ ok: false, error: "invalid_recording_id" }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("stop_ride_safety_recording", {
      p_recording_id: recordingId,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    return taxiJson({
      ok: true,
      recording: result.recording,
      consent_message: SAFETY_RECORDING_CONSENT_MESSAGE,
    });
  } catch (e: unknown) {
    return taxiJson({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
}
