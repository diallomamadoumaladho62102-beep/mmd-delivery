import { NextRequest } from "next/server";
import {
  getTaxiRideId,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import {
  buildSafetyRecordingStatusPayload,
  isActiveTaxiRideStatus,
  notifySafetyRecordingStarted,
  SAFETY_RECORDING_CONSENT_MESSAGE,
  type SafetyRecordingRow,
} from "@/lib/rideSafetyRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const rideId = String(req.nextUrl.searchParams.get("ride_id") ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
      return taxiJson({ ok: false, error: "invalid_ride_id" }, 400);
    }

    const { data: ride } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id,client_user_id,driver_id,status,country_code,pickup_city")
      .eq("id", rideId)
      .maybeSingle();

    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);

    const userId = auth.user.id;
    const isClient = String(ride.client_user_id) === userId;
    const isDriver = String(ride.driver_id ?? "") === userId;
    if (!isClient && !isDriver) return taxiJson({ ok: false, error: "forbidden" }, 403);

    const { data: rules } = await auth.supabaseAdmin.rpc("resolve_ride_safety_recording_rules", {
      p_country_code: ride.country_code,
      p_state_code: null,
      p_city: ride.pickup_city,
    });

    const { data: recordings, error } = await auth.supabaseAdmin
      .from("ride_safety_recordings")
      .select("*")
      .eq("taxi_ride_id", rideId)
      .order("created_at", { ascending: false });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const statusPayload = buildSafetyRecordingStatusPayload(
      (recordings ?? []) as SafetyRecordingRow[],
    );

    return taxiJson({
      ok: true,
      ride_active: isActiveTaxiRideStatus(ride.status),
      rules: rules ?? null,
      client_audio_allowed: rules?.client_audio_allowed !== false,
      driver_video_allowed: rules?.driver_video_allowed !== false,
      retention_days: rules?.retention_days ?? 14,
      consent_message: SAFETY_RECORDING_CONSENT_MESSAGE,
      ...statusPayload,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    const rideId = getTaxiRideId(body as Record<string, unknown>);
    const recordingType = String(body.recording_type ?? body.recordingType ?? "").trim();

    if (!["client_audio", "driver_video"].includes(recordingType)) {
      return taxiJson({ ok: false, error: "invalid_recording_type" }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("start_ride_safety_recording", {
      p_ride_id: rideId,
      p_recording_type: recordingType,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok !== true) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    const recording = result.recording as Record<string, unknown>;
    const { data: ride } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("client_user_id,driver_id")
      .eq("id", rideId)
      .maybeSingle();

    const initiatorRole = String(recording.initiator_role ?? "");
    const otherPartyUserId =
      initiatorRole === "client"
        ? String(ride?.driver_id ?? "")
        : String(ride?.client_user_id ?? "");

    if (otherPartyUserId) {
      await notifySafetyRecordingStarted({
        supabaseAdmin: auth.supabaseAdmin,
        rideId,
        recordingType: recordingType as "client_audio" | "driver_video",
        initiatorRole: initiatorRole as "client" | "driver",
        otherPartyUserId,
      });

      await auth.supabaseAdmin.rpc("log_ride_safety_recording_event", {
        p_recording_id: recording.id,
        p_taxi_ride_id: rideId,
        p_event_type: "participant_notified",
        p_actor_user_id: auth.user.id,
        p_actor_role: initiatorRole,
        p_metadata: { notified_user_id: otherPartyUserId },
      });
    }

    return taxiJson({
      ok: true,
      recording,
      consent_message: SAFETY_RECORDING_CONSENT_MESSAGE,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, message.includes("Missing") ? 400 : 500);
  }
}
