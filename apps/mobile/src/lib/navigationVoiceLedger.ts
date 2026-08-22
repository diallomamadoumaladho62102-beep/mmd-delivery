let lastSpokenText = "";
let lastSpokenAt = 0;
const spokenInstructionCounts = new Map<string, number>();

export const MIN_REPEAT_DELAY_MS = 12_000;
export const MAX_INSTRUCTION_SPEAKS = 2;

export function canSpeakInstructionKey(
  instructionKey: string,
  maxSpeaks = MAX_INSTRUCTION_SPEAKS,
): boolean {
  const key = instructionKey.trim();
  if (!key) return true;
  return (spokenInstructionCounts.get(key) ?? 0) < maxSpeaks;
}

export function recordInstructionKeySpoken(instructionKey: string): void {
  const key = instructionKey.trim();
  if (!key) return;
  spokenInstructionCounts.set(key, (spokenInstructionCounts.get(key) ?? 0) + 1);
}

export function resetNavigationVoiceLedger(): void {
  spokenInstructionCounts.clear();
  lastSpokenText = "";
  lastSpokenAt = 0;
}

export function shouldSkipTextRepeat(
  cleanText: string,
  force: boolean,
  instructionKey: string | undefined,
  now: number,
): boolean {
  const stableKey = instructionKey?.trim() ?? "";
  if (stableKey && !canSpeakInstructionKey(stableKey)) {
    return true;
  }
  if (
    !stableKey &&
    !force &&
    cleanText === lastSpokenText &&
    now - lastSpokenAt < MIN_REPEAT_DELAY_MS
  ) {
    return true;
  }
  return false;
}

export function getLastNavigationSpeechAt(): number {
  return lastSpokenAt;
}

export function markNavigationSpeech(
  cleanText: string,
  instructionKey: string | undefined,
  now: number,
): void {
  const stableKey = instructionKey?.trim() ?? "";
  if (stableKey) {
    recordInstructionKeySpoken(stableKey);
  }
  lastSpokenText = cleanText;
  lastSpokenAt = now;
}
