/**
 * Pure state-machine tests for exactly-two COMPLETE navigation readings.
 */
import assert from "node:assert/strict";
import {
  beginInstructionCycle,
  canStartInstructionCycle,
  cancelInstructionPlayback,
  completeInstructionReading,
  createIdlePlaybackState,
  isPlaybackActive,
  MAX_COMPLETE_READINGS,
  shouldSpeakSecondReading,
} from "./navigationVoicePlayback";

const COMPLETE =
  "À 100 mètres, tournez à gauche.";

function simulateTwoCompleteReadings(instructionKey: string, text: string) {
  const utterances: string[] = [];
  let state = createIdlePlaybackState();

  assert.equal(canStartInstructionCycle(state, instructionKey), true);
  state = beginInstructionCycle(state, instructionKey, text);
  assert.equal(state.phase, "reading_1");
  utterances.push(state.text);

  // GPS / re-render spam must not restart.
  assert.equal(canStartInstructionCycle(state, instructionKey), false);

  state = completeInstructionReading(state);
  assert.equal(state.phase, "reading_2");
  assert.equal(state.completedReadings, 1);
  assert.equal(shouldSpeakSecondReading(state), true);
  utterances.push(state.text);

  state = completeInstructionReading(state);
  assert.equal(state.phase, "stopped");
  assert.equal(state.completedReadings, MAX_COMPLETE_READINGS);
  assert.equal(shouldSpeakSecondReading(state), false);
  assert.equal(canStartInstructionCycle(state, instructionKey), false);
  assert.equal(isPlaybackActive(state), false);

  // Third completion is a no-op — still stopped at 2.
  const again = completeInstructionReading(state);
  assert.equal(again.phase, "stopped");
  assert.equal(again.completedReadings, 2);

  return utterances;
}

{
  const utterances = simulateTwoCompleteReadings("maneuver-a:500", COMPLETE);
  assert.deepEqual(utterances, [COMPLETE, COMPLETE]);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[2], undefined);
  console.log("ok exactly two complete readings — no third");
}

{
  // Partial / cancelled utterance must NOT count as a completed reading.
  let state = beginInstructionCycle(
    createIdlePlaybackState(),
    "m1:500",
    COMPLETE,
  );
  state = cancelInstructionPlayback(state);
  assert.equal(state.phase, "stopped");
  assert.equal(state.completedReadings, 0);
  assert.equal(canStartInstructionCycle(state, "m1:500"), false);
  console.log("ok cancelled partial does not count as complete reading");
}

{
  // New maneuver may start a fresh two-reading cycle.
  let state = beginInstructionCycle(
    createIdlePlaybackState(),
    "left:500",
    COMPLETE,
  );
  state = completeInstructionReading(state);
  state = completeInstructionReading(state);
  assert.equal(state.phase, "stopped");

  const nextText = "À 50 mètres, tournez à droite.";
  assert.equal(canStartInstructionCycle(state, "right:500"), true);
  state = beginInstructionCycle(state, "right:500", nextText);
  assert.equal(state.phase, "reading_1");
  assert.equal(state.text, nextText);
  assert.equal(state.completedReadings, 0);
  state = completeInstructionReading(state);
  state = completeInstructionReading(state);
  assert.equal(state.phase, "stopped");
  assert.equal(state.completedReadings, 2);
  console.log("ok new maneuver starts a fresh two-reading cycle");
}

{
  // Same maneuver + changing distance phrase must NOT be treated as new if key stable.
  const key = "turn-left:500";
  let state = beginInstructionCycle(
    createIdlePlaybackState(),
    key,
    "Dans 100 mètres, tournez à gauche.",
  );
  assert.equal(canStartInstructionCycle(state, key), false);
  // Simulated GPS text variants are ignored when key is unchanged.
  assert.equal(
    canStartInstructionCycle(state, key),
    false,
    "99m variant same key blocked",
  );
  console.log("ok stable instruction key blocks GPS distance spam");
}

console.log("navigationVoicePlayback tests passed");
