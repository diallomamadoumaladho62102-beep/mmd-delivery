import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const screen = fs.readFileSync(path.join(here, "../screens/MmdAiScreen.tsx"), "utf8");
const speech = fs.readFileSync(path.join(here, "mmdAiSpeech.ts"), "utf8");

assert.match(screen, /testID="mmd-ai-mic"/);
assert.match(screen, /accessibilityLabel/);
assert.match(screen, /announceForAccessibility/);
assert.match(screen, /mmd.ai.voice.state.listening/);
assert.match(screen, /mmd.ai.voice.permissionBody/);
assert.match(screen, /inputMode !== "text"/);
assert.match(screen, /TaxiRideTracking/);
assert.match(screen, /ClientRestaurantMenu/);
assert.match(screen, /requiresConfirmation/);

assert.match(speech, /requestPermissionsAsync/);
assert.match(speech, /\/api\/ai\/transcribe/);
assert.doesNotMatch(speech, /ACCESS_BACKGROUND_LOCATION/);
assert.doesNotMatch(screen, /requestBackgroundPermissionsAsync/);

console.log("mmdAiVoiceA11y.test.ts OK");
