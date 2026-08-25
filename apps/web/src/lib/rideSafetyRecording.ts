import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";
import {
  pushText,
  safetyRecordingKindLabel,
  type PushCopyKey,
} from "./pushCopy";
import { normalizeAppLocale, type AppLocale } from "./userLocale";

export const SAFETY_RECORDING_CONSENT_MESSAGE =
  "A safety recording is in progress on your device to protect this ride. The other party is notified but does not control your microphone.";

export const SAFETY_RECORDING_RETENTION_DAYS = 14;

export type SafetyRecordingType = "client_audio" | "driver_audio" | "driver_video";
export type SafetyRecordingStatus =
  | "recording"
  | "uploaded"
  | "available"
  | "expired"
  | "deleted"
  | "locked_for_review";

export type SafetyRecordingRow = {
  id: string;
  taxi_ride_id: string;
  initiator_user_id: string;
  initiator_role: "client" | "driver";
  recording_type: SafetyRecordingType;
  status: SafetyRecordingStatus;
  storage_path?: string | null;
  expires_at?: string | null;
  retention_days?: number;
  started_at?: string;
  stopped_at?: string | null;
  locked_for_review?: boolean;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const ACTIVE_RIDE_STATUSES = new Set(["accepted", "driver_arrived", "in_progress"]);

type PushTarget = { token: string; locale: AppLocale };

async function loadUserExpoTokens(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<PushTarget[]> {
  const { data: tokenRows } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .eq("user_id", userId);

  const seen = new Set<string>();
  const out: PushTarget[] = [];
  for (const row of (tokenRows ?? []) as Array<Record<string, unknown>>) {
    if (row.disabled === true || row.is_active === false) continue;
    const token = String(row.expo_push_token ?? row.push_token ?? row.token ?? "").trim();
    if (
      !(token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")) ||
      seen.has(token)
    ) {
      continue;
    }
    seen.add(token);
    out.push({ token, locale: normalizeAppLocale(row.locale) });
  }
  return out;
}

async function sendExpoPush(messages: Array<Record<string, unknown>>): Promise<void> {
  if (messages.length === 0) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (e: unknown) {
    console.log(
      "[ride safety recording] push error:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function notifySafetyRecordingStarted(params: {
  supabaseAdmin: SupabaseClient;
  rideId: string;
  recordingType: SafetyRecordingType;
  initiatorRole: "client" | "driver";
  otherPartyUserId: string;
}): Promise<void> {
  const tokens = await loadUserExpoTokens(params.supabaseAdmin, params.otherPartyUserId);
  if (tokens.length === 0) return;

  const startedKey: PushCopyKey =
    params.recordingType === "client_audio"
      ? "safety_recording_started_client"
      : params.recordingType === "driver_audio"
        ? "safety_recording_started_driver_audio"
        : "safety_recording_started_driver_video";

  await sendExpoPush(
    tokens.map((target) => {
      const copy = pushText(startedKey, target.locale);
      return {
        to: target.token,
        sound: resolvePushSound("client_update"),
        title: copy.title,
        body: copy.body,
        data: {
          type: "taxi_safety_recording_started",
          taxi_ride_id: params.rideId,
          recording_type: params.recordingType,
          initiator_role: params.initiatorRole,
        },
      };
    }),
  );
}

export async function notifySafetyRecordingExpiry(params: {
  supabaseAdmin: SupabaseClient;
  recording: SafetyRecordingRow;
  warning: "3d" | "24h";
}): Promise<void> {
  const tokens = await loadUserExpoTokens(
    params.supabaseAdmin,
    params.recording.initiator_user_id,
  );
  if (tokens.length === 0) return;

  const expiryKey: PushCopyKey =
    params.warning === "3d" ? "safety_recording_expiry_3d" : "safety_recording_expiry_24h";

  await sendExpoPush(
    tokens.map((target) => {
      const copy = pushText(expiryKey, target.locale, {
        kind: safetyRecordingKindLabel(target.locale, params.recording.recording_type),
      });
      return {
        to: target.token,
        sound: resolvePushSound("warning"),
        title: copy.title,
        body: copy.body,
        data: {
          type: "taxi_safety_recording_expiry",
          recording_id: params.recording.id,
          taxi_ride_id: params.recording.taxi_ride_id,
          warning: params.warning,
        },
      };
    }),
  );
}

export function isActiveTaxiRideStatus(status: unknown): boolean {
  return ACTIVE_RIDE_STATUSES.has(String(status ?? "").toLowerCase());
}

export function buildSafetyRecordingStatusPayload(recordings: SafetyRecordingRow[]) {
  const active = recordings.filter((row) => row.status === "recording");
  const clientRecording = active.find((row) => row.recording_type === "client_audio");
  const driverAudioRecording = active.find((row) => row.recording_type === "driver_audio");
  const driverVideoRecording = active.find((row) => row.recording_type === "driver_video");

  return {
    consent_message: SAFETY_RECORDING_CONSENT_MESSAGE,
    client_audio_active: Boolean(clientRecording),
    driver_audio_active: Boolean(driverAudioRecording),
    driver_video_active: Boolean(driverVideoRecording),
    any_active: active.length > 0,
    active_recordings: active.map((row) => ({
      id: row.id,
      recording_type: row.recording_type,
      initiator_role: row.initiator_role,
      status: row.status,
      started_at: row.started_at ?? null,
    })),
    recordings,
  };
}

export async function processRideSafetyRecordingRetention(
  supabaseAdmin: SupabaseClient,
): Promise<Record<string, unknown>> {
  const { data: purgeResult, error } = await supabaseAdmin.rpc(
    "purge_expired_ride_safety_recordings",
  );
  if (error) throw new Error(error.message);

  const payload = (purgeResult ?? {}) as Record<string, unknown>;
  const warn3Count = Number(payload.warnings_3d ?? 0);
  const warn24Count = Number(payload.warnings_24h ?? 0);

  // Only notify when THIS purge run stamped new warnings. Retries after a
  // successful purge return 0 and must not re-send push notifications.
  const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  if (warn3Count > 0) {
    const { data: warn3Rows } = await supabaseAdmin
      .from("ride_safety_recordings")
      .select("*")
      .not("warning_3d_sent_at", "is", null)
      .gte("warning_3d_sent_at", recentCutoff);

    for (const row of (warn3Rows ?? []) as SafetyRecordingRow[]) {
      await notifySafetyRecordingExpiry({
        supabaseAdmin,
        recording: row,
        warning: "3d",
      }).catch(() => null);
    }
  }

  if (warn24Count > 0) {
    const { data: warn24Rows } = await supabaseAdmin
      .from("ride_safety_recordings")
      .select("*")
      .not("warning_24h_sent_at", "is", null)
      .gte("warning_24h_sent_at", recentCutoff);

    for (const row of (warn24Rows ?? []) as SafetyRecordingRow[]) {
      await notifySafetyRecordingExpiry({
        supabaseAdmin,
        recording: row,
        warning: "24h",
      }).catch(() => null);
    }
  }

  const { data: deletedRows } = await supabaseAdmin
    .from("ride_safety_recordings")
    .select("id,storage_bucket,storage_path")
    .eq("status", "deleted")
    .not("storage_path", "is", null)
    .limit(100);

  let storageDeleted = 0;
  for (const row of deletedRows ?? []) {
    const path = String(row.storage_path ?? "").trim();
    if (path) {
      await supabaseAdmin.storage
        .from(String(row.storage_bucket ?? "ride-safety-recordings"))
        .remove([path]);
      storageDeleted += 1;
    }
    await supabaseAdmin
      .from("ride_safety_recordings")
      .update({ storage_path: null, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  return { ...payload, storage_files_deleted: storageDeleted };
}

export function buildSafetyRecordingStoragePath(params: {
  rideId: string;
  recordingId: string;
  extension: string;
}): string {
  return `${params.rideId}/${params.recordingId}/${Date.now()}.${params.extension}`;
}
