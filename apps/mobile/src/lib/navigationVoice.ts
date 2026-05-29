import * as Speech from "expo-speech";

let lastSpokenText = "";
let lastSpokenAt = 0;

const MIN_REPEAT_DELAY_MS = 12000;

export async function speakNavigation(
  text: string,
  force = false,
) {
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
      language: "en-US",
      pitch: 1,
      rate: 0.92,
    });
  } catch (e) {
    console.log("speakNavigation error:", e);
  }
}

export async function stopNavigationVoice() {
  try {
    await Speech.stop();
  } catch (e) {
    console.log("stopNavigationVoice error:", e);
  }
}