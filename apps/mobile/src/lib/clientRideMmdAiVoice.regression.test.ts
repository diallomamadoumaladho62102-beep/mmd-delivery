import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Client ride round FAB (voice conversation with MMD AI) is NOT Ask MMD AI.
 * Turn-based listen → STT → chat → TTS → listen. Not duplex WebRTC.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

const taxi = read("src/screens/taxi/TaxiRideTrackingScreen.tsx");
const food = read("src/screens/ClientOrderDetailsScreen.tsx");
const delivery = read("src/screens/ClientDeliveryRequestDetailsScreen.tsx");
const home = read("src/components/client/home/ClientHomeV4View.tsx");
const ask = read("src/screens/MmdAiScreen.tsx");
const fab = read("src/components/tracking/ClientRideMmdAiVoiceFab.tsx");
const host = read("src/components/tracking/ClientRideMmdAiVoiceHost.tsx");
const hook = read("src/hooks/useClientMmdAiVoiceSession.ts");
const speech = read("src/lib/mmdAiSpeech.ts");
const voice = read("src/lib/mmdAiVoice.ts");
const api = read("src/lib/mmdAiApi.ts");

assert.match(taxi, /ClientRideMmdAiVoiceHost/);
assert.match(taxi, /taxi_ride_voice/);
assert.match(food, /ClientRideMmdAiVoiceHost/);
assert.match(food, /food_ride_voice/);
assert.match(delivery, /ClientRideMmdAiVoiceHost/);
assert.match(delivery, /delivery_ride_voice/);

assert.doesNotMatch(home, /ClientRideMmdAiVoiceHost/);
assert.doesNotMatch(ask, /ClientRideMmdAiVoiceHost/);
assert.match(home, /onNavigateAi/);
assert.match(ask, /mmd\.ai\.title/);
assert.match(ask, /testID="mmd-ai-mic"/);

assert.match(fab, /testID="client-ride-mmd-ai-voice-fab"/);
assert.match(fab, /accessibilityLabel/);
assert.match(fab, /accessibilityHint/);
assert.match(fab, /Ionicons/);
assert.match(host, /announceForAccessibility/);
assert.match(host, /voiceFabLabelKey/);
assert.match(host, /getMicrophonePermission/);

assert.match(hook, /listenUntilSilence/);
assert.match(hook, /transcribeMmdAiAudio/);
assert.match(hook, /postAiChat/);
assert.match(hook, /speakMmdAiReply/);
assert.match(hook, /requestStopMmdAiListen/);
assert.match(hook, /stopMmdAiSpeech/);
assert.match(hook, /Not duplex WebRTC/);

assert.match(speech, /listenUntilSilence/);
assert.match(speech, /VOICE_LISTEN_MAX_MS/);
assert.match(speech, /requestStopMmdAiListen/);
assert.match(speech, /mmd_ai_transcribe_getSession/);
assert.match(speech, /allowsRecordingIOS: false/);

assert.match(voice, /onDone: finish/);
assert.match(voice, /onStopped: finish/);
assert.match(voice, /SPEAK_MAX_MS/);

assert.match(api, /mmd_ai_getSession/);
assert.match(api, /fetchWithTimeout/);
assert.match(api, /mmd_ai_chat/);

const localesDir = path.join(mobileRoot, "src/i18n/locales");
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const extras = JSON.parse(
    fs.readFileSync(path.join(localesDir, lang, "extras.json"), "utf8"),
  );
  const ride = extras?.mmd?.ai?.voice?.ride ?? {};
  const state = extras?.mmd?.ai?.voice?.state ?? {};
  for (const key of [
    "badge",
    "labelIdle",
    "labelConnecting",
    "labelListening",
    "labelThinking",
    "labelSpeaking",
    "labelError",
    "labelEnded",
    "hintIdle",
    "hintListening",
    "hintBargeIn",
    "hintRetry",
  ]) {
    assert.ok(String(ride[key] ?? "").trim(), `${lang} missing mmd.ai.voice.ride.${key}`);
  }
  for (const key of ["connecting", "thinking", "error", "ended", "listening"]) {
    assert.ok(String(state[key] ?? "").trim(), `${lang} missing mmd.ai.voice.state.${key}`);
  }
}

console.log("clientRideMmdAiVoice.regression.test.ts OK");
