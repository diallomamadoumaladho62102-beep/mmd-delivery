import * as Speech from "expo-speech";
import {
  beginInstructionCycle,
  canStartInstructionCycle,
  cancelInstructionPlayback,
  completeInstructionReading,
  createIdlePlaybackState,
  isPlaybackActive,
  shouldSpeakSecondReading,
  type InstructionPlaybackState,
} from "./navigationVoicePlayback";
import {
  getLastNavigationSpeechAt,
  markNavigationSpeech,
  resetNavigationVoiceLedger,
  shouldSkipTextRepeat,
} from "./navigationVoiceLedger";

export {
  canSpeakInstructionKey,
  recordInstructionKeySpoken,
  resetNavigationVoiceLedger,
} from "./navigationVoiceLedger";

export type { InstructionPlaybackPhase } from "./navigationVoicePlayback";

const PROGRESS_VOICE_MS = 30_000;

export type NavigationVoiceLanguage = "en-US" | "fr-FR";

type SpeakOptions = {
  language: NavigationVoiceLanguage;
  onDone: () => void;
  onStopped: () => void;
  onError: () => void;
};

let playbackState: InstructionPlaybackState = createIdlePlaybackState();
/** Monotonic token so stale TTS callbacks cannot advance a newer cycle. */
let playbackGeneration = 0;

function speakOnce(text: string, options: SpeakOptions): void {
  Speech.speak(text, {
    language: options.language,
    pitch: 1,
    rate: 0.92,
    onDone: options.onDone,
    onStopped: options.onStopped,
    onError: options.onError,
  });
}

function advanceAfterCompleteReading(
  generation: number,
  language: NavigationVoiceLanguage,
): void {
  if (generation !== playbackGeneration) return;

  playbackState = completeInstructionReading(playbackState);

  if (shouldSpeakSecondReading(playbackState)) {
    const text = playbackState.text;
    const key = playbackState.instructionKey;
    speakOnce(text, {
      language,
      onDone: () => advanceAfterCompleteReading(generation, language),
      onStopped: () => {
        if (generation !== playbackGeneration) return;
        // Interrupted mid reading #2 — do not count as complete; stop cycle.
        playbackState = cancelInstructionPlayback(playbackState);
      },
      onError: () => {
        if (generation !== playbackGeneration) return;
        playbackState = cancelInstructionPlayback(playbackState);
      },
    });
    markNavigationSpeech(text, key, Date.now());
    return;
  }

  // STOPPED after exactly two complete readings (or already stopped).
}

/**
 * Speak a navigation instruction as ONE complete unit, exactly twice, then stop.
 *
 * - Completions counted only via TTS onDone (full utterance).
 * - Same instructionKey while active/stopped → no restart / no 3rd reading.
 * - New instructionKey cancels the previous cycle and starts a fresh 2-reading cycle.
 * - GPS / re-render callers that re-request the same key are ignored.
 */
export async function speakNavigation(
  text: string,
  force = false,
  language: NavigationVoiceLanguage = "en-US",
  instructionKey?: string,
): Promise<void> {
  try {
    const cleanText = text.trim();
    if (!cleanText) return;

    const stableKey = (instructionKey ?? "").trim();
    const now = Date.now();

    // Progress / one-off lines without a stable key: keep legacy debounce.
    if (!stableKey) {
      if (shouldSkipTextRepeat(cleanText, force, undefined, now)) return;
      markNavigationSpeech(cleanText, undefined, now);
      playbackGeneration += 1;
      const generation = playbackGeneration;
      playbackState = createIdlePlaybackState();
      await Speech.stop();
      speakOnce(cleanText, {
        language,
        onDone: () => undefined,
        onStopped: () => undefined,
        onError: () => undefined,
      });
      void generation;
      return;
    }

    // Same instruction already running or finished its two readings → ignore.
    if (!canStartInstructionCycle(playbackState, stableKey)) {
      return;
    }

    // Also honor ledger hard cap (defense in depth).
    if (shouldSkipTextRepeat(cleanText, force, stableKey, now)) {
      return;
    }

    const switching =
      isPlaybackActive(playbackState) &&
      playbackState.instructionKey !== stableKey;

    playbackGeneration += 1;
    const generation = playbackGeneration;
    playbackState = beginInstructionCycle(
      createIdlePlaybackState(),
      stableKey,
      cleanText,
    );

    if (switching) {
      await Speech.stop();
    } else {
      // Ensure no leftover utterance from another subsystem.
      await Speech.stop();
    }

    markNavigationSpeech(cleanText, stableKey, now);

    speakOnce(cleanText, {
      language,
      onDone: () => advanceAfterCompleteReading(generation, language),
      onStopped: () => {
        if (generation !== playbackGeneration) return;
        playbackState = cancelInstructionPlayback(playbackState);
      },
      onError: () => {
        if (generation !== playbackGeneration) return;
        playbackState = cancelInstructionPlayback(playbackState);
      },
    });
  } catch {
    // Voice must never crash navigation
  }
}

/** Test/diagnostic access — not for UI. */
export function getNavigationVoicePlaybackState(): InstructionPlaybackState {
  return { ...playbackState };
}

/** Reset playback + ledger (reroute / leave navigation). */
export async function stopNavigationVoice(): Promise<void> {
  try {
    playbackGeneration += 1;
    playbackState = createIdlePlaybackState();
    await Speech.stop();
    resetNavigationVoiceLedger();
  } catch {
    // ignore
  }
}

export async function speakNavigationProgress(
  text: string,
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  const now = Date.now();
  if (now - getLastNavigationSpeechAt() < PROGRESS_VOICE_MS) return;
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

  await speakNavigation(text, true, language, `arrival:${stage}`);
}

export async function speakReroute(
  language: NavigationVoiceLanguage = "en-US",
): Promise<void> {
  const text = language.startsWith("fr")
    ? "Itinéraire recalculé"
    : "Route recalculated";
  await speakNavigation(text, true, language, "reroute");
}

export function resolveNavigationVoiceLanguage(
  appLanguage: string | undefined,
): NavigationVoiceLanguage {
  return appLanguage?.toLowerCase().startsWith("fr") ? "fr-FR" : "en-US";
}
