import {
  canSpeakInstructionKey,
  recordInstructionKeySpoken,
  resetNavigationVoiceLedger,
} from "./navigationVoiceLedger";
import {
  beginInstructionCycle,
  canStartInstructionCycle,
  completeInstructionReading,
  createIdlePlaybackState,
} from "./navigationVoicePlayback";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

resetNavigationVoiceLedger();
const key = "maneuver-1:500";

assert(canSpeakInstructionKey(key), "first speak allowed");
recordInstructionKeySpoken(key);
assert(canSpeakInstructionKey(key), "second speak allowed");
recordInstructionKeySpoken(key);
assert(!canSpeakInstructionKey(key), "third speak blocked");

resetNavigationVoiceLedger();
assert(canSpeakInstructionKey(key), "counter resets on reroute ledger reset");

// Regression: one COMPLETE instruction → exactly two complete readings, no 3rd.
const COMPLETE = "À 100 mètres, tournez à gauche.";
const spoken: string[] = [];
let playback = createIdlePlaybackState();
assert(canStartInstructionCycle(playback, key), "cycle may start");
playback = beginInstructionCycle(playback, key, COMPLETE);
spoken.push(playback.text);
assert(!canStartInstructionCycle(playback, key), "GPS spam cannot restart mid-cycle");
playback = completeInstructionReading(playback);
spoken.push(playback.text);
playback = completeInstructionReading(playback);
assert(playback.phase === "stopped", "stopped after two completes");
assert(spoken.length === 2, "utteranceCount === 2");
assert(spoken[0] === COMPLETE && spoken[1] === COMPLETE, "both readings complete");
assert(spoken[2] === undefined, "no utterance[2]");
assert(!canStartInstructionCycle(playback, key), "third reading impossible");

console.log("navigationVoice.regression.test.ts — PASS");
