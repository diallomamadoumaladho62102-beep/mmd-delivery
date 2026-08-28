import type { AppLanguageCode } from "../i18n/languageOptions";
import { SUPPORTED_LANGUAGE_CODES } from "../i18n/languageOptions";

export type AiTtsLanguage = "en-US" | "fr-FR" | "es-ES" | "ar-SA" | "zh-CN";

export type AiVoiceLanguageResolution = {
  appLocale: AppLanguageCode;
  /** Whisper / STT BCP-47 base. Null = let the engine auto-detect. */
  sttLanguage: "en" | "fr" | "es" | "ar" | "zh" | null;
  ttsLanguage: AiTtsLanguage;
  ttsFallback: boolean;
  sttFallback: boolean;
};

const TTS_BY_APP: Record<AppLanguageCode, AiTtsLanguage | null> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ar: "ar-SA",
  zh: "zh-CN",
  ff: null,
};

const STT_BY_APP: Record<AppLanguageCode, AiVoiceLanguageResolution["sttLanguage"]> = {
  en: "en",
  fr: "fr",
  es: "es",
  ar: "ar",
  zh: "zh",
  ff: null,
};

export function normalizeAppLocale(raw: string | undefined): AppLanguageCode {
  const base = String(raw ?? "en").toLowerCase().split("-")[0];
  return (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(base)
    ? (base as AppLanguageCode)
    : "en";
}

/**
 * Map MMD app locales to engines that actually exist in this repo:
 * - TTS: expo-speech (device voices). Fulfulde is not a standard OS TTS locale.
 * - STT: OpenAI whisper-1. Fulfulde is not a documented Whisper language code.
 */
export function resolveAiVoiceLanguages(
  appLanguage: string | undefined
): AiVoiceLanguageResolution {
  const appLocale = normalizeAppLocale(appLanguage);
  const tts = TTS_BY_APP[appLocale];
  const stt = STT_BY_APP[appLocale];
  return {
    appLocale,
    sttLanguage: stt,
    ttsLanguage: tts ?? "en-US",
    ttsFallback: tts == null,
    sttFallback: stt == null,
  };
}

export function pickAvailableTtsLanguage(
  preferred: AiTtsLanguage,
  deviceVoiceLanguages: string[]
): { language: AiTtsLanguage; usedFallback: boolean } {
  if (!deviceVoiceLanguages.length) {
    return { language: preferred, usedFallback: false };
  }
  const normalized = deviceVoiceLanguages.map((v) => v.toLowerCase());
  const pref = preferred.toLowerCase();
  if (normalized.some((v) => v === pref || v.startsWith(pref.slice(0, 2)))) {
    return { language: preferred, usedFallback: false };
  }
  if (normalized.some((v) => v.startsWith("en"))) {
    return { language: "en-US", usedFallback: true };
  }
  return { language: preferred, usedFallback: true };
}
