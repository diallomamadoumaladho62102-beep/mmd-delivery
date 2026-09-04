/**
 * Instruction-level TTS playback: exactly two COMPLETE utterances, then STOP.
 *
 * Counts completions via Speech onDone only — never partial chunks, never
 * speech-start, never GPS ticks. Same instruction key cannot restart after
 * STOPPED until a new key is requested.
 */

export type InstructionPlaybackPhase =
  | "idle"
  | "reading_1"
  | "reading_2"
  | "stopped";

export type InstructionPlaybackState = {
  instructionKey: string;
  text: string;
  phase: InstructionPlaybackPhase;
  /** Number of COMPLETE utterances finished for this key (0–2). */
  completedReadings: number;
};

export const MAX_COMPLETE_READINGS = 2;

export function createIdlePlaybackState(): InstructionPlaybackState {
  return {
    instructionKey: "",
    text: "",
    phase: "idle",
    completedReadings: 0,
  };
}

/**
 * Decide whether a speak request for `instructionKey` may start a new cycle.
 * Same key while reading or already stopped → reject (no restart / no 3rd).
 */
export function canStartInstructionCycle(
  state: InstructionPlaybackState,
  instructionKey: string,
): boolean {
  const key = instructionKey.trim();
  if (!key) return false;
  if (state.phase === "idle" || !state.instructionKey) return true;
  if (state.instructionKey !== key) return true;
  // Same instruction while reading or after STOPPED → never restart / no 3rd.
  return false;
}

/** Begin READING_1 for a new (or first) instruction. */
export function beginInstructionCycle(
  state: InstructionPlaybackState,
  instructionKey: string,
  text: string,
): InstructionPlaybackState {
  const key = instructionKey.trim();
  const clean = text.trim();
  if (!key || !clean) return state;
  return {
    instructionKey: key,
    text: clean,
    phase: "reading_1",
    completedReadings: 0,
  };
}

/**
 * A COMPLETE utterance finished (TTS onDone for the full string).
 * reading_1 → reading_2 | reading_2 → stopped.
 * Does not advance on cancel/error.
 */
export function completeInstructionReading(
  state: InstructionPlaybackState,
): InstructionPlaybackState {
  if (state.phase !== "reading_1" && state.phase !== "reading_2") {
    return state;
  }
  const completedReadings = Math.min(
    MAX_COMPLETE_READINGS,
    state.completedReadings + 1,
  );
  if (completedReadings >= MAX_COMPLETE_READINGS) {
    return {
      ...state,
      completedReadings,
      phase: "stopped",
    };
  }
  return {
    ...state,
    completedReadings,
    phase: "reading_2",
  };
}

/** Explicit cancel/interrupt — does NOT count as a completed reading. */
export function cancelInstructionPlayback(
  state: InstructionPlaybackState,
): InstructionPlaybackState {
  if (state.phase === "idle" || state.phase === "stopped") return state;
  return {
    ...state,
    phase: "stopped",
    // completedReadings unchanged — partials never count
  };
}

export function shouldSpeakSecondReading(
  state: InstructionPlaybackState,
): boolean {
  return state.phase === "reading_2" && state.completedReadings === 1;
}

export function isPlaybackActive(state: InstructionPlaybackState): boolean {
  return state.phase === "reading_1" || state.phase === "reading_2";
}
