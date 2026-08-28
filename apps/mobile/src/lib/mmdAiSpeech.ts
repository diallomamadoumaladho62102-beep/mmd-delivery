import { Audio } from "expo-av";
import { API_BASE_URL } from "./apiBase";
import { MmdAiApiError } from "./mmdAiApi";
import { supabase } from "./supabase";

let activeRecording: Audio.Recording | null = null;

export async function getMicrophonePermission(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  const current = await Audio.getPermissionsAsync();
  return {
    granted: current.granted === true,
    canAskAgain: current.canAskAgain !== false,
  };
}

export async function requestMicrophonePermission(): Promise<boolean> {
  const result = await Audio.requestPermissionsAsync();
  return result.granted === true;
}

export async function startMmdAiRecording(): Promise<void> {
  if (activeRecording) {
    await stopMmdAiRecording();
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  activeRecording = recording;
}

export async function stopMmdAiRecording(): Promise<string | null> {
  const recording = activeRecording;
  activeRecording = null;
  if (!recording) return null;
  try {
    await recording.stopAndUnloadAsync();
    return recording.getURI();
  } catch {
    return null;
  }
}

export async function cancelMmdAiRecording(): Promise<void> {
  const recording = activeRecording;
  activeRecording = null;
  if (!recording) return;
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // ignore
  }
}

export async function transcribeMmdAiAudio(params: {
  uri: string;
  locale: string;
}): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) {
    throw new MmdAiApiError("Session expired. Please sign in again.", "UNAUTHORIZED");
  }

  const form = new FormData();
  form.append("locale", params.locale);
  form.append("file", {
    uri: params.uri,
    name: "mmd-ai-voice.m4a",
    type: "audio/m4a",
  } as unknown as Blob);

  const res = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}/api/ai/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const out = (await res.json().catch(() => null)) as
    | { ok: true; text: string }
    | { ok: false; error?: string; code?: string }
    | null;

  if (!out || out.ok !== true) {
    const err = out && "error" in out ? out : null;
    throw new MmdAiApiError(
      err && "error" in err ? String(err.error) : "Voice transcription failed",
      err && "code" in err ? err.code : "OPENAI_ERROR"
    );
  }

  return String(out.text ?? "").trim();
}
