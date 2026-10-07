/**
 * Voice navigation silence + language regression.
 *
 * The previous bug: Speech.stop() for a route change could finish AFTER the
 * next Speech.speak(), the swallowed utterance was marked complete, and that
 * instruction never retried. Arabic, Chinese, Spanish, and Fulfulde were also
 * collapsed onto English or French.
 */
import assert from "node:assert/strict";
import { createSpeechChain } from "./navigationSpeechChain";
import {
  beginInstructionCycle,
  canStartInstructionCycle,
  createIdlePlaybackState,
  playbackAfterFailedStart,
} from "./navigationVoicePlayback";
import { resolveNavigationTtsLanguage } from "./mmdAiVoiceLanguages";
import {
  formatManeuverVoice,
  resolveVoicePhraseLocale,
} from "./navigationManeuvers";
import {
  evaluateManeuverVoice,
  initVoiceTriggerState,
} from "./navigationVoiceTriggers";
import type { ActiveManeuverSelection } from "./navigationManeuvers";

const rightTurn: ActiveManeuverSelection = {
  active: {
    id: "step-1",
    index: 1,
    kind: "turn-right",
    rawInstruction: "Turn right",
    streetName: "Main St",
    alongRouteMeters: 400,
    point: null,
    isArrival: false,
  },
  distanceMeters: 400,
  secondary: null,
  secondaryDistanceMeters: null,
};

// A stop that is still in flight must finish before the next speak starts.
const events: string[] = [];
const chain = createSpeechChain();
let releaseStop: () => void = () => undefined;
const stopGate = new Promise<void>((resolve) => {
  releaseStop = resolve;
});
async function assertStopFinishesBeforeSpeak(): Promise<void> {
  const stopDone = chain.enqueue(async () => {
    events.push("stop-start");
    await stopGate;
    events.push("stop-end");
  });
  const speakDone = chain.enqueue(async () => {
    events.push("speak");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["stop-start"]);
  releaseStop();
  await stopDone;
  await speakDone;
  assert.deepEqual(events, ["stop-start", "stop-end", "speak"]);
}

// A swallowed first utterance (no onDone) must leave the key retryable.
const started = beginInstructionCycle(
  createIdlePlaybackState(),
  "step-1:500",
  "turn right",
);
assert.equal(canStartInstructionCycle(started, "step-1:500"), false);
const afterSilentStop = playbackAfterFailedStart(started);
assert.equal(afterSilentStop.phase, "idle");
assert.equal(afterSilentStop.completedReadings, 0);
assert.equal(canStartInstructionCycle(afterSilentStop, "step-1:500"), true);

// A second reading that already completed once stays locked.
const afterOne = playbackAfterFailedStart({
  ...started,
  phase: "reading_2",
  completedReadings: 1,
});
assert.equal(afterOne.phase, "stopped");
assert.equal(canStartInstructionCycle(afterOne, "step-1:500"), false);

assert.equal(resolveVoicePhraseLocale("ar"), "ar");
assert.equal(resolveVoicePhraseLocale("zh-CN"), "zh");
assert.equal(resolveVoicePhraseLocale("ff"), "ff");
assert.equal(resolveVoicePhraseLocale("es"), "es");
assert.equal(resolveVoicePhraseLocale("fr"), "fr");
assert.equal(resolveNavigationTtsLanguage("es"), "es-ES");
assert.equal(resolveNavigationTtsLanguage("ar"), "ar-SA");
assert.equal(resolveNavigationTtsLanguage("zh"), "zh-CN");
assert.equal(resolveNavigationTtsLanguage("fr"), "fr-FR");
assert.equal(resolveNavigationTtsLanguage("ff"), "en-US");

const arabic = formatManeuverVoice({
  maneuver: rightTurn.active,
  distanceMeters: 500,
  locale: "ar",
});
assert.equal(arabic.includes("انعطف يميناً"), true);
assert.equal(arabic.includes("turn right"), false);

const fulani = formatManeuverVoice({
  maneuver: rightTurn.active,
  distanceMeters: 500,
  locale: "ff",
});
assert.equal(fulani.includes("yah to ñaamo"), true);
assert.equal(fulani.includes("tournez"), false);

const chinese = formatManeuverVoice({
  maneuver: rightTurn.active,
  distanceMeters: null,
  locale: "zh",
});
assert.equal(chinese.startsWith("现在"), true);
assert.equal(chinese.includes("右转"), true);

const spoken = evaluateManeuverVoice({
  state: initVoiceTriggerState("route-a"),
  routeVersion: "route-a",
  selection: rightTurn,
  locale: "es",
});
assert.equal(spoken.announcement?.text.includes("gire a la derecha"), true);
assert.equal(spoken.announcement?.text.includes("turn right"), false);

const rerouted = evaluateManeuverVoice({
  state: spoken.state,
  routeVersion: "route-b",
  selection: {
    ...rightTurn,
    active: { ...rightTurn.active, id: "step-2", kind: "turn-left", streetName: "Oak Ave" },
  },
  locale: "es",
});
assert.equal(rerouted.announcement?.text.includes("gire a la izquierda"), true);
assert.equal(rerouted.announcement?.text.includes("Main St"), false);

void assertStopFinishesBeforeSpeak()
  .then(() => {
    console.log("navigationVoiceSilence.regression.test.ts ok");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
