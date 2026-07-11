/**
 * Distance-threshold voice trigger engine (500 m / 200 m / immediate / arrival).
 *
 * Requirements honored:
 * - Threshold *crossing*, never exact equality: a bucket fires the first time
 *   the live distance drops into its band, so a GPS jump 540 m → 470 m still
 *   fires the 500 m announcement.
 * - Per-maneuver memory keyed by a stable id, so the same announcement is not
 *   repeated on every GPS update.
 * - If a maneuver first appears already close (e.g. after a reroute), the 500 m
 *   bucket is skipped and the 200 m bucket fires instead.
 * - Reroute resets all memory (state carries the current `routeVersion`).
 */
import {
  formatManeuverVoice,
  type ActiveManeuverSelection,
  type RouteManeuver,
} from "./navigationManeuvers";
import { resolveNavigationLocale, type NavigationLocale } from "./navigationLocale";

export type VoiceBucket = "500" | "200" | "immediate" | "arrival";

/** Lower = more urgent. Used to arbitrate nav vs safety announcements. */
export enum VoicePriority {
  ImmediateManeuver = 0,
  Nav200 = 1,
  SafetyNear = 2,
  Nav500 = 3,
  Safety500 = 4,
  Info = 5,
}

type ManeuverAnnounceFlags = {
  a500: boolean;
  a200: boolean;
  immediate: boolean;
  arrival: boolean;
};

export type VoiceTriggerState = {
  routeVersion: string;
  byManeuver: Record<string, ManeuverAnnounceFlags>;
};

export type VoiceAnnouncement = {
  bucket: VoiceBucket;
  maneuverId: string;
  text: string;
  priority: VoicePriority;
};

export type VoiceTriggerResult = {
  state: VoiceTriggerState;
  announcement: VoiceAnnouncement | null;
};

/** Distance thresholds and their upper tolerance bands (GPS irregularity). */
export const VOICE_THRESHOLDS = {
  far: 500,
  farBandTop: 550,
  near: 200,
  nearBandTop: 230,
  immediate: 45,
  arrival: 60,
} as const;

export function initVoiceTriggerState(routeVersion = ""): VoiceTriggerState {
  return { routeVersion, byManeuver: {} };
}

function flagsFor(
  state: VoiceTriggerState,
  maneuverId: string,
): ManeuverAnnounceFlags {
  return (
    state.byManeuver[maneuverId] ?? {
      a500: false,
      a200: false,
      immediate: false,
      arrival: false,
    }
  );
}

/**
 * Evaluate the active maneuver against the trigger thresholds.
 * Returns updated state plus at most one announcement to speak now.
 */
export function evaluateManeuverVoice(params: {
  state: VoiceTriggerState;
  routeVersion: string;
  selection: ActiveManeuverSelection | null;
  locale: string | NavigationLocale;
}): VoiceTriggerResult {
  const locale =
    typeof params.locale === "string"
      ? resolveNavigationLocale(params.locale)
      : params.locale;

  // Reroute (or first run) → reset all per-maneuver memory.
  let state = params.state;
  if (state.routeVersion !== params.routeVersion) {
    state = { routeVersion: params.routeVersion, byManeuver: {} };
  }

  const selection = params.selection;
  if (!selection) return { state, announcement: null };

  const { active, distanceMeters } = selection;
  const flags = { ...flagsFor(state, active.id) };
  let announcement: VoiceAnnouncement | null = null;

  const speak = (bucket: VoiceBucket, distance: number | null, priority: VoicePriority) => {
    announcement = {
      bucket,
      maneuverId: active.id,
      priority,
      text: formatManeuverVoice({ maneuver: active, distanceMeters: distance, locale }),
    };
  };

  if (active.isArrival) {
    if (!flags.arrival && distanceMeters <= VOICE_THRESHOLDS.arrival) {
      flags.arrival = true;
      speak("arrival", null, VoicePriority.ImmediateManeuver);
    }
  } else if (!flags.immediate && distanceMeters <= VOICE_THRESHOLDS.immediate) {
    // Immediate "now" — also marks the closer buckets as done.
    flags.immediate = true;
    flags.a200 = true;
    flags.a500 = true;
    speak("immediate", null, VoicePriority.ImmediateManeuver);
  } else if (!flags.a200 && distanceMeters <= VOICE_THRESHOLDS.nearBandTop) {
    // Entered the 200 m band (fires even if we skipped 500 due to a reroute).
    flags.a200 = true;
    flags.a500 = true;
    speak("200", VOICE_THRESHOLDS.near, VoicePriority.Nav200);
  } else if (
    !flags.a500 &&
    distanceMeters <= VOICE_THRESHOLDS.farBandTop &&
    distanceMeters > VOICE_THRESHOLDS.nearBandTop
  ) {
    flags.a500 = true;
    speak("500", VOICE_THRESHOLDS.far, VoicePriority.Nav500);
  }

  const nextState: VoiceTriggerState = {
    routeVersion: params.routeVersion,
    byManeuver: { ...state.byManeuver, [active.id]: flags },
  };

  return { state: nextState, announcement };
}

/**
 * Arbitrate between simultaneous announcements. Keeps the most urgent one and
 * returns the rest (still-relevant) as deferred, so a safety alert never masks
 * an urgent navigation maneuver.
 */
export function resolveVoicePriority(
  candidates: Array<VoiceAnnouncement | null | undefined>,
): { primary: VoiceAnnouncement | null; deferred: VoiceAnnouncement[] } {
  const valid = candidates.filter(
    (c): c is VoiceAnnouncement => c != null,
  );
  if (!valid.length) return { primary: null, deferred: [] };

  const sorted = [...valid].sort((a, b) => a.priority - b.priority);
  return { primary: sorted[0], deferred: sorted.slice(1) };
}

/** Convenience: does a maneuver still have pending (unspoken) buckets? */
export function hasPendingBuckets(
  state: VoiceTriggerState,
  maneuver: Pick<RouteManeuver, "id">,
): boolean {
  const flags = state.byManeuver[maneuver.id];
  if (!flags) return true;
  return !(flags.a500 && flags.a200);
}
