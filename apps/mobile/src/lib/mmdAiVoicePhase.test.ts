import assert from "node:assert/strict";
import {
  isVoiceSessionActive,
  voiceFabHintKey,
  voiceFabIcon,
  voiceFabLabelKey,
  voiceFabTapAction,
  voiceFabTint,
  type MmdAiVoicePhase,
} from "./mmdAiVoicePhase";

const phases: MmdAiVoicePhase[] = [
  "idle",
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "error",
  "ended",
];

assert.equal(voiceFabTapAction("idle"), "start");
assert.equal(voiceFabTapAction("ended"), "start");
assert.equal(voiceFabTapAction("listening"), "stop-listen");
assert.equal(voiceFabTapAction("speaking"), "barge-in");
assert.equal(voiceFabTapAction("thinking"), "barge-in");
assert.equal(voiceFabTapAction("connecting"), "barge-in");
assert.equal(voiceFabTapAction("error"), "retry");

assert.equal(voiceFabIcon("idle"), "mic-outline");
assert.equal(voiceFabIcon("listening"), "mic");
assert.equal(voiceFabIcon("speaking"), "volume-high");
assert.equal(voiceFabIcon("error"), "alert-circle");

assert.notEqual(voiceFabTint("idle"), voiceFabTint("listening"));
assert.notEqual(voiceFabTint("listening"), voiceFabTint("speaking"));
assert.notEqual(voiceFabTint("speaking"), voiceFabTint("error"));

assert.equal(isVoiceSessionActive("idle"), false);
assert.equal(isVoiceSessionActive("ended"), false);
assert.equal(isVoiceSessionActive("listening"), true);
assert.equal(isVoiceSessionActive("thinking"), true);

for (const phase of phases) {
  assert.match(voiceFabLabelKey(phase), /^mmd\.ai\.voice\.ride\.label/);
  assert.match(voiceFabHintKey(phase), /^mmd\.ai\.voice\.ride\.hint/);
}

console.log("mmdAiVoicePhase.test.ts OK");
