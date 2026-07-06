import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePushSound } from "./mmdPushSounds";

export const SAFETY_RECORDING_CONSENT_MESSAGE =
  "Un enregistrement de sécurité est en cours pour protéger les deux parties.";

export const SAFETY_RECORDING_RETENTION_DAYS = 14;

export type SafetyRecordingType = "client_audio" | "driver_video";
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

function recordingTypeLabel(type: SafetyRecordingType): string {
  return type === "client_audio" ? "audio client" : "vidéo chauffeur";
}

async function loadUserExpoTokens(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data: tokenRows } = await supabaseAdmin
    .from("user_push_tokens")
    .select("*")
    .eq("user_id", userId);

  return Array.from(
    new Set(
      (tokenRows ?? [])
        .filter(
          (row: Record<string, unknown>) =>
            row.disabled !== true && row.is_active !== false,
        )
        .map((row: Record<string, unknown>) =>
          String(row.expo_push_token ?? row.push_token ?? row.token ?? "").trim(),
        )
        .filter(
          (token) =>
            token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken["),
        ),
    ),
  );
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

  const who =
    params.initiatorRole === "client"
      ? "Le client a démarré un enregistrement audio de sécurité."
      : "Le chauffeur a démarré un enregistrement vidéo de sécurité.";

  await sendExpoPush(
    tokens.map((token) => ({
      to: token,
      sound: resolvePushSound("client_update"),
      title: "Enregistrement de sécurité",
      body: `${who} ${SAFETY_RECORDING_CONSENT_MESSAGE}`,
      data: {
        type: "taxi_safety_recording_started",
        taxi_ride_id: params.rideId,
        recording_type: params.recordingType,
        initiator_role: params.initiatorRole,
      },
    })),
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

  const label =
    params.warning === "3d"
      ? "3 jours avant suppression automatique"
      : "24 heures avant suppression automatique";

  await sendExpoPush(
    tokens.map((token) => ({
      to: token,
      sound: resolvePushSound("warning"),
      title: "Enregistrement de sécurité",
      body: `Téléchargez votre ${recordingTypeLabel(params.recording.recording_type)} : ${label}.`,
      data: {
        type: "taxi_safety_recording_expiry",
        recording_id: params.recording.id,
        taxi_ride_id: params.recording.taxi_ride_id,
        warning: params.warning,
      },
    })),
  );
}

export function isActiveTaxiRideStatus(status: unknown): boolean {
  return ACTIVE_RIDE_STATUSES.has(String(status ?? "").toLowerCase());
}

export function buildSafetyRecordingStatusPayload(recordings: SafetyRecordingRow[]) {
  const active = recordings.filter((row) => row.status === "recording");
  const clientRecording = active.find((row) => row.recording_type === "client_audio");
  const driverRecording = active.find((row) => row.recording_type === "driver_video");

  return {
    consent_message: SAFETY_RECORDING_CONSENT_MESSAGE,
    client_audio_active: Boolean(clientRecording),
    driver_video_active: Boolean(driverRecording),
    any_active: active.length > 0,
    active_recordings: active,
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

  const { data: warn3Rows } = await supabaseAdmin
    .from("ride_safety_recordings")
    .select("*")
    .not("warning_3d_sent_at", "is", null)
    .gte("warning_3d_sent_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

  for (const row of (warn3Rows ?? []) as SafetyRecordingRow[]) {
    await notifySafetyRecordingExpiry({
      supabaseAdmin,
      recording: row,
      warning: "3d",
    }).catch(() => null);
  }

  const { data: warn24Rows } = await supabaseAdmin
    .from("ride_safety_recordings")
    .select("*")
    .not("warning_24h_sent_at", "is", null)
    .gte("warning_24h_sent_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());

  for (const row of (warn24Rows ?? []) as SafetyRecordingRow[]) {
    await notifySafetyRecordingExpiry({
      supabaseAdmin,
      recording: row,
      warning: "24h",
    }).catch(() => null);
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
