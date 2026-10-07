import { AppState } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Speech from "expo-speech";
import {
  resolveNavigationTtsLanguage,
  type AiTtsLanguage,
} from "./mmdAiVoiceLanguages";
import {
  beginInstructionCycle,
  canStartInstructionCycle,
  cancelInstructionPlayback,
  completeInstructionReading,
  createIdlePlaybackState,
  playbackAfterFailedStart,
  shouldSpeakSecondReading,
  type InstructionPlaybackState,
} from "./navigationVoicePlayback";
import { createSpeechChain } from "./navigationSpeechChain";
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

export type NavigationVoiceLanguage = AiTtsLanguage;

/** One speech operation at a time so a late Speech.stop() cannot cancel the next utterance. */
const speechChain = createSpeechChain();
let navigationAudioReady = false;
const failedStarts = new Map<string, number>();
const MAX_FAILED_STARTS = 2;

function enqueueSpeechOp(op: () => Promise<void>): Promise<void> {
  return speechChain.enqueue(op);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureNavigationAudioSession(): Promise<void> {
  if (navigationAudioReady) return;
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    playThroughEarpieceAndroid: false,
  });
  navigationAudioReady = true;
}

AppState.addEventListener("change", (state) => {
  if (state === "active") navigationAudioReady = false;
});

async function haltIfSpeaking(): Promise<void> {
  const isSpeaking = Speech.isSpeakingAsync;
  if (typeof isSpeaking !== "function") return;
  if (!(await isSpeaking())) return;
  await Speech.stop();
  await delay(120);
}

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

  if (!shouldSpeakSecondReading(playbackState)) return;

  const text = playbackState.text;
  const key = playbackState.instructionKey;
  void enqueueSpeechOp(async () => {
    if (generation !== playbackGeneration) return;
    await ensureNavigationAudioSession();
    speakOnce(text, {
      language,
      onDone: () => {
        if (generation !== playbackGeneration) return;
        markNavigationSpeech(text, key, Date.now());
        advanceAfterCompleteReading(generation, language);
      },
      onStopped: () => {
        if (generation !== playbackGeneration) return;
        playbackState = cancelInstructionPlayback(playbackState);
      },
      onError: () => {
        if (generation !== playbackGeneration) return;
        playbackState = cancelInstructionPlayback(playbackState);
      },
    });
  });
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
  const cleanText = text.trim();
  if (!cleanText) return;

  const stableKey = (instructionKey ?? "").trim();
  const now = Date.now();

  if (!stableKey) {
    if (shouldSkipTextRepeat(cleanText, force, undefined, now)) return;
  } else {
    if (!canStartInstructionCycle(playbackState, stableKey)) return;
    if (shouldSkipTextRepeat(cleanText, force, stableKey, now)) return;
  }

  playbackGeneration += 1;
  const generation = playbackGeneration;
  playbackState = stableKey
    ? beginInstructionCycle(createIdlePlaybackState(), stableKey, cleanText)
    : createIdlePlaybackState();

  await enqueueSpeechOp(async () => {
    if (generation !== playbackGeneration) return;
    try {
      await ensureNavigationAudioSession();
      await haltIfSpeaking();
      if (generation !== playbackGeneration) return;
      if (!stableKey) markNavigationSpeech(cleanText, undefined, Date.now());
      speakOnce(cleanText, {
        language,
        onDone: () => {
          if (generation !== playbackGeneration) return;
          if (stableKey) {
            failedStarts.delete(stableKey);
            markNavigationSpeech(cleanText, stableKey, Date.now());
          }
          if (stableKey) advanceAfterCompleteReading(generation, language);
        },
        onStopped: () => failStart(generation, stableKey),
        onError: () => failStart(generation, stableKey),
      });
    } catch {
      if (generation === playbackGeneration) {
        playbackState = playbackAfterFailedStart(playbackState);
      }
    }
  });
}

/** Test/diagnostic access — not for UI. */
export function getNavigationVoicePlaybackState(): InstructionPlaybackState {
  return { ...playbackState };
}

function failStart(generation: number, stableKey: string): void {
  if (generation !== playbackGeneration) return;
  if (playbackState.completedReadings <= 0 && stableKey) {
    const fails = (failedStarts.get(stableKey) ?? 0) + 1;
    failedStarts.set(stableKey, fails);
    if (fails >= MAX_FAILED_STARTS) {
      playbackState = cancelInstructionPlayback(playbackState);
      return;
    }
  }
  playbackState = playbackAfterFailedStart(playbackState);
}

/** Reset playback + ledger (reroute / leave navigation). */
export async function stopNavigationVoice(): Promise<void> {
  playbackGeneration += 1;
  playbackState = createIdlePlaybackState();
  failedStarts.clear();
  resetNavigationVoiceLedger();
  await enqueueSpeechOp(async () => {
    try {
      await haltIfSpeaking();
    } catch {
      // ignore
    }
  });
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
  text?: string,
): Promise<void> {
  const spoken = (text ?? "").trim();
  if (!spoken) return;
  await speakNavigation(spoken, true, language, `arrival:${stage}`);
}

export async function speakReroute(
  language: NavigationVoiceLanguage = "en-US",
  text?: string,
): Promise<void> {
  const spoken = (text ?? "").trim();
  if (!spoken) return;
  await speakNavigation(spoken, true, language, "reroute");
}

export function resolveNavigationVoiceLanguage(
  appLanguage: string | undefined,
): NavigationVoiceLanguage {
  return resolveNavigationTtsLanguage(appLanguage);
}
