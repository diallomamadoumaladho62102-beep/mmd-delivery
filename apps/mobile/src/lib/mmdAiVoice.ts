import * as Speech from "expo-speech";
import {
  pickAvailableTtsLanguage,
  resolveAiVoiceLanguages,
  type AiTtsLanguage,
} from "./mmdAiVoiceLanguages";

let cachedDeviceLanguages: string[] | null = null;

export async function loadDeviceTtsLanguages(): Promise<string[]> {
  if (cachedDeviceLanguages) return cachedDeviceLanguages;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    cachedDeviceLanguages = (voices ?? [])
      .map((v) => String(v.language ?? "").trim())
      .filter(Boolean);
  } catch {
    cachedDeviceLanguages = [];
  }
  return cachedDeviceLanguages;
}

export async function speakMmdAiReply(
  text: string,
  appLanguage: string | undefined
): Promise<{ language: AiTtsLanguage; usedFallback: boolean }> {
  const clean = String(text ?? "").trim();
  const resolved = resolveAiVoiceLanguages(appLanguage);
  const device = await loadDeviceTtsLanguages();
  const picked = pickAvailableTtsLanguage(resolved.ttsLanguage, device);
  if (!clean) return picked;

  try {
    await Speech.stop();
    Speech.speak(clean, {
      language: picked.language,
      pitch: 1,
      rate: 0.94,
    });
  } catch {
    // Voice must never crash chat.
  }
  return {
    language: picked.language,
    usedFallback: resolved.ttsFallback || picked.usedFallback,
  };
}

export async function stopMmdAiSpeech(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // ignore
  }
}
