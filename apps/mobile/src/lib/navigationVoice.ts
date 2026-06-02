import * as Speech from "expo-speech";

let lastSpokenText = "";
let lastSpokenAt = 0;

const MIN_REPEAT_DELAY_MS = 12_000;
const PROGRESS_VOICE_MS = 30_000;

export type NavigationVoiceLanguage = "en-US" | "fr-FR";

export async function speakNavigation(
  text: string,
  force = false,
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  try {
    const cleanText = text.trim();
    if (!cleanText) return;

    const now = Date.now();

    if (
      !force &&
      cleanText === lastSpokenText &&
      now - lastSpokenAt < MIN_REPEAT_DELAY_MS
    ) {
      return;
    }

    lastSpokenText = cleanText;
    lastSpokenAt = now;

    await Speech.stop();

    Speech.speak(cleanText, {
      language,
      pitch: 1,
      rate: 0.92,
    });
  } catch {
    // Voice must never crash navigation
  }
}

export async function speakNavigationProgress(
  text: string,
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  const now = Date.now();
  if (now - lastSpokenAt < PROGRESS_VOICE_MS) return;
  await speakNavigation(text, false, language);
}

export async function speakArrival(
  stage: "pickup" | "dropoff",
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  const text =
    stage === "pickup"
      ? language.startsWith("fr")
        ? "Arrivée au point de collecte"
        : "Arriving at pickup location"
      : language.startsWith("fr")
        ? "Arrivée à destination"
        : "Arriving at destination";

  await speakNavigation(text, true, language);
}

export async function speakReroute(
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  const text = language.startsWith("fr")
    ? "Itinéraire recalculé"
    : "Route recalculated";
  await speakNavigation(text, true, language);
}

export async function stopNavigationVoice(): Promise<void> {
  try {
    await Speech.stop();
    lastSpokenText = "";
    lastSpokenAt = 0;
  } catch {
    // ignore
  }
}

export function resolveNavigationVoiceLanguage(
  appLanguage: string | undefined,
): NavigationVoiceLanguage {
  return appLanguage?.toLowerCase().startsWith("fr") ? "fr-FR" : "en-US";
}
