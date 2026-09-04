/**
 * Distance-threshold voice trigger engine.
 *
 * One COMPLETE instruction per maneuver (stable id). The TTS playback layer
 * speaks that same complete text exactly twice, then stops. GPS updates that
 * only change remaining meters must not create a new instruction.
 *
 * - Threshold *crossing*, never exact equality.
 * - Per-maneuver memory keyed by stable maneuver id.
 * - If a maneuver first appears already close (reroute), announce at near distance.
 * - Reroute resets memory when `routeVersion` changes.
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
  /** Primary approach instruction already dispatched (TTS will read it twice). */
  announced: boolean;
  arrival: boolean;
  /**
   * Instruction cycles started for this maneuver (max 1 approach + optional
   * arrival). Playback performs 2 complete readings per cycle.
   */
  spokenCount: number;
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

/**
 * Distance thresholds — one approach announcement per maneuver when first
 * entering the far band (or near band if already closer after reroute).
 */
export const VOICE_THRESHOLDS = {
  far: 500,
  farBandTop: 550,
  near: 200,
  nearBandTop: 210,
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
      announced: false,
      arrival: false,
      spokenCount: 0,
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

  const speak = (
    bucket: VoiceBucket,
    distance: number | null,
    priority: VoicePriority,
  ) => {
    announcement = {
      bucket,
      maneuverId: active.id,
      priority,
      text: formatManeuverVoice({
        maneuver: active,
        distanceMeters: distance,
        locale,
      }),
    };
    flags.spokenCount += 1;
  };

  if (active.isArrival) {
    if (!flags.arrival && distanceMeters <= VOICE_THRESHOLDS.arrival) {
      flags.arrival = true;
      flags.announced = true;
      speak("arrival", null, VoicePriority.ImmediateManeuver);
    }
  } else if (!flags.announced && distanceMeters <= VOICE_THRESHOLDS.farBandTop) {
    // Lock distance phrase at trigger time (threshold), not live GPS meters,
    // so 100→99→98 m updates cannot reinvent the instruction identity/text.
    const lockedDistance =
      distanceMeters <= VOICE_THRESHOLDS.nearBandTop
        ? VOICE_THRESHOLDS.near
        : VOICE_THRESHOLDS.far;
    const bucket: VoiceBucket =
      lockedDistance === VOICE_THRESHOLDS.near ? "200" : "500";
    const priority =
      bucket === "200" ? VoicePriority.Nav200 : VoicePriority.Nav500;
    flags.announced = true;
    speak(bucket, lockedDistance, priority);
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

/** Convenience: does a maneuver still have a pending approach announcement? */
export function hasPendingBuckets(
  state: VoiceTriggerState,
  maneuver: Pick<RouteManeuver, "id">,
): boolean {
  const flags = state.byManeuver[maneuver.id];
  if (!flags) return true;
  return !flags.announced;
}
