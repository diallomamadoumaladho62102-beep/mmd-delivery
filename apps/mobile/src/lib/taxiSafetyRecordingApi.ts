import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { uploadFile } from "./uploadFile";

const BUCKET = "ride-safety-recordings";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired. Please sign in again.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export type SafetyRecordingStatus = {
  ok: boolean;
  ride_active?: boolean;
  client_audio_allowed?: boolean;
  driver_video_allowed?: boolean;
  client_audio_active?: boolean;
  driver_video_active?: boolean;
  any_active?: boolean;
  consent_message?: string;
  recordings?: Array<Record<string, unknown>>;
};

export async function fetchSafetyRecordingStatus(rideId: string): Promise<SafetyRecordingStatus> {
  const res = await fetch(
    `${baseUrl()}/api/taxi/rides/safety-recording?ride_id=${encodeURIComponent(rideId)}`,
    { headers: await getAuthHeaders() },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error ?? `Request failed (${res.status})`));
  }
  return out as SafetyRecordingStatus;
}

export async function startSafetyRecording(params: {
  rideId: string;
  recordingType: "client_audio" | "driver_video";
}) {
  const res = await fetch(`${baseUrl()}/api/taxi/rides/safety-recording`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      taxi_ride_id: params.rideId,
      recording_type: params.recordingType,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error ?? out.message ?? `Request failed (${res.status})`));
  }
  return out as { recording: Record<string, unknown>; consent_message?: string };
}

export async function stopSafetyRecording(recordingId: string) {
  const res = await fetch(`${baseUrl()}/api/taxi/rides/safety-recording/stop`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ recording_id: recordingId }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error ?? `Request failed (${res.status})`));
  }
  return out;
}

export async function completeSafetyRecordingUpload(params: {
  recordingId: string;
  storagePath: string;
  fileSizeBytes: number;
  mimeType: string;
  extension: string;
}) {
  const res = await fetch(`${baseUrl()}/api/taxi/rides/safety-recording/upload`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      recording_id: params.recordingId,
      storage_path: params.storagePath,
      file_size_bytes: params.fileSizeBytes,
      mime_type: params.mimeType,
      extension: params.extension,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error ?? `Request failed (${res.status})`));
  }
  return out;
}

export async function getSafetyRecordingDownloadUrl(recordingId: string) {
  const res = await fetch(`${baseUrl()}/api/taxi/rides/safety-recording/${recordingId}`, {
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) {
    throw new Error(String(out.error ?? `Request failed (${res.status})`));
  }
  return out as { download_url: string };
}

export async function uploadSafetyRecordingFile(params: {
  rideId: string;
  recordingId: string;
  uri: string;
  mimeType: string;
  extension: string;
}) {
  const path = `${params.rideId}/${params.recordingId}/${Date.now()}.${params.extension}`;

  await uploadFile({
    bucket: BUCKET,
    path,
    uri: params.uri,
    contentType: params.mimeType,
  });

  const response = await fetch(params.uri);
  const blob = await response.blob();

  return completeSafetyRecordingUpload({
    recordingId: params.recordingId,
    storagePath: path,
    fileSizeBytes: blob.size,
    mimeType: params.mimeType,
    extension: params.extension,
  });
}
