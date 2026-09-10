import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { API_BASE_URL } from "./apiBase";
import {
  AUTH_ACTION_TIMEOUT_MS,
  BOOT_AUTH_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "./bootFailOpen";
import { MmdAiApiError } from "./mmdAiApi";
import { supabase } from "./supabase";

export const VOICE_LISTEN_MAX_MS = 12_000;
export const VOICE_SILENCE_AFTER_SPEECH_MS = 1_200;
export const VOICE_SPEECH_METER_DB = -35;

let activeRecording: Audio.Recording | null = null;
let audioMode: "idle" | "record" | "playback" = "idle";

async function setRecordMode(): Promise<void> {
  if (audioMode === "record") return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    playThroughEarpieceAndroid: false,
  });
  audioMode = "record";
}

async function setPlaybackMode(): Promise<void> {
  if (audioMode === "playback") return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    playThroughEarpieceAndroid: false,
  });
  audioMode = "playback";
}

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

  await setRecordMode();

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync({
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  await recording.startAsync();
  activeRecording = recording;
}

export async function stopMmdAiRecording(): Promise<string | null> {
  const recording = activeRecording;
  activeRecording = null;
  if (!recording) return null;
  try {
    recording.setOnRecordingStatusUpdate(null);
  } catch {
    // ignore
  }
  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    await setPlaybackMode();
    return uri;
  } catch {
    await setPlaybackMode().catch(() => undefined);
    return null;
  }
}

export async function cancelMmdAiRecording(): Promise<void> {
  const recording = activeRecording;
  activeRecording = null;
  if (!recording) return;
  try {
    recording.setOnRecordingStatusUpdate(null);
  } catch {
    // ignore
  }
  try {
    await recording.stopAndUnloadAsync();
  } catch {
    // ignore
  }
  await setPlaybackMode().catch(() => undefined);
}

let listenStopHandler: (() => void) | null = null;

/** Ends the current listen turn early (client tapped “done speaking”). */
export function requestStopMmdAiListen(): void {
  listenStopHandler?.();
}

export async function listenUntilSilence(): Promise<string | null> {
  await startMmdAiRecording();
  const recording = activeRecording;
  if (!recording) return null;

  return await new Promise((resolve) => {
    let heardSpeech = false;
    let silenceStartedAt: number | null = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      listenStopHandler = null;
      clearTimeout(maxTimer);
      try {
        recording.setOnRecordingStatusUpdate(null);
      } catch {
        // ignore
      }
      void stopMmdAiRecording().then(resolve);
    };

    listenStopHandler = finish;
    const maxTimer = setTimeout(finish, VOICE_LISTEN_MAX_MS);

    try {
      const rec = recording as Audio.Recording & {
        setProgressUpdateInterval?: (ms: number) => void;
      };
      rec.setProgressUpdateInterval?.(200);
    } catch {
      // Metering still works on the default interval when this API is missing.
    }

    recording.setOnRecordingStatusUpdate((status) => {
      if (finished || !status.isRecording) return;
      const now = Date.now();
      const db = typeof status.metering === "number" ? status.metering : -160;
      if (db > VOICE_SPEECH_METER_DB) {
        heardSpeech = true;
        silenceStartedAt = null;
        return;
      }
      if (!heardSpeech) return;
      if (silenceStartedAt == null) silenceStartedAt = now;
      if (now - silenceStartedAt >= VOICE_SILENCE_AFTER_SPEECH_MS) {
        finish();
      }
    });
  });
}

export async function transcribeMmdAiAudio(params: {
  uri: string;
  locale: string;
}): Promise<string> {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    BOOT_AUTH_TIMEOUT_MS,
    "mmd_ai_transcribe_getSession",
  );
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

  const res = await fetchWithTimeout(
    `${String(API_BASE_URL).replace(/\/$/, "")}/api/ai/transcribe`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
    AUTH_ACTION_TIMEOUT_MS,
    "mmd_ai_transcribe",
  );

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
