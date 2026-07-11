/**
 * Pure voice announcement queue with priority ordering, de-duplication,
 * minimum spacing between spoken items, and cancellation of announcements that
 * became obsolete (e.g. a safety alert for an event now behind the driver, or a
 * maneuver already passed) before they were ever spoken.
 */
import type { VoiceAnnouncement } from "./navigationVoiceTriggers";

export type QueuedVoice = VoiceAnnouncement & {
  enqueuedAt: number;
  expiresAt: number;
};

export type VoiceQueueState = {
  items: QueuedVoice[];
  lastSpokenAt: number;
};

export function initVoiceQueue(): VoiceQueueState {
  return { items: [], lastSpokenAt: 0 };
}

function itemKey(a: Pick<VoiceAnnouncement, "maneuverId" | "bucket">): string {
  return `${a.maneuverId}:${a.bucket}`;
}

/** Add an announcement unless the same maneuver+bucket is already queued. */
export function enqueueVoice(
  state: VoiceQueueState,
  announcement: VoiceAnnouncement | null | undefined,
  now: number,
  ttlMs = 15_000,
): VoiceQueueState {
  if (!announcement) return state;
  const key = itemKey(announcement);
  if (state.items.some((item) => itemKey(item) === key)) return state;
  return {
    ...state,
    items: [
      ...state.items,
      { ...announcement, enqueuedAt: now, expiresAt: now + ttlMs },
    ],
  };
}

/**
 * Drop queued items that expired or whose target is no longer active
 * (`activeIds` = maneuverIds still relevant right now). This is the
 * cancellation of obsolete alerts.
 */
export function pruneVoiceQueue(
  state: VoiceQueueState,
  now: number,
  activeIds: Set<string>,
): VoiceQueueState {
  const items = state.items.filter(
    (item) => item.expiresAt > now && activeIds.has(item.maneuverId),
  );
  if (items.length === state.items.length) return state;
  return { ...state, items };
}

/**
 * Pop the highest-priority queued announcement if the minimum gap since the
 * last spoken item has elapsed. Returns the updated state and the item to speak
 * (or null).
 */
export function takeNextVoice(
  state: VoiceQueueState,
  now: number,
  minGapMs = 3200,
): { state: VoiceQueueState; announcement: QueuedVoice | null } {
  if (!state.items.length) return { state, announcement: null };
  if (now - state.lastSpokenAt < minGapMs) return { state, announcement: null };

  const sorted = [...state.items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.enqueuedAt - b.enqueuedAt;
  });
  const next = sorted[0];
  const items = state.items.filter((item) => item !== next);
  return {
    state: { items, lastSpokenAt: now },
    announcement: next,
  };
}
