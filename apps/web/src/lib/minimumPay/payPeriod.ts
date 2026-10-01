import type { MinimumPayEngineSettings } from "./types";
import {
  addCalendarDaysInZone,
  isValidTimeZone,
  nextWeekdayMidnightAfter,
} from "./zonedTime";

/**
 * Period rule (Admin-configured, never hardcoded):
 * - First period startsAt = engine_start_at (never earlier than activation).
 * - First period endsAt = next period_start_weekday 00:00 in settings.timezone
 *   strictly after startsAt. A Wednesday activation with Monday weekday
 *   therefore ends the following Monday local midnight, not the prior Monday.
 * - Later periods start at the previous end and last period_length_days
 *   calendar days in settings.timezone (DST-aware, not N × 24h UTC).
 * - Local civil bounds are converted to absolute UTC timestamps.
 */
export function nextPeriodWindow(input: {
  settings: MinimumPayEngineSettings;
  previousEndsAtIso?: string | null;
}): { startsAt: string; endsAt: string } | { error: string } {
  const days = input.settings.periodLengthDays;
  const startAt = input.settings.engineStartAt;
  const timezone = String(input.settings.timezone ?? "").trim();
  const weekday = input.settings.periodStartWeekday;
  if (!days || days <= 0) return { error: "period_length_required" };
  if (!startAt) return { error: "engine_start_required" };
  if (!timezone) return { error: "timezone_required" };
  if (!isValidTimeZone(timezone)) return { error: "invalid_timezone" };
  if (weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { error: "period_start_weekday_required" };
  }

  if (input.previousEndsAtIso) {
    const startsAt = input.previousEndsAtIso;
    if (!periodStartsOnOrAfterEngine(input.settings, startsAt)) {
      return { error: "period_before_engine_start" };
    }
    const endsAt = addCalendarDaysInZone(startsAt, days, timezone);
    if (!endsAt) return { error: "invalid_period_window" };
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return { error: "invalid_period_window" };
    return { startsAt, endsAt };
  }

  const engineMs = Date.parse(startAt);
  if (!Number.isFinite(engineMs)) return { error: "invalid_engine_start" };
  const startsAt = new Date(engineMs).toISOString();
  const alignedEnd = nextWeekdayMidnightAfter(startsAt, weekday, timezone);
  if (!alignedEnd) return { error: "invalid_period_window" };
  if (Date.parse(alignedEnd) <= engineMs) return { error: "invalid_period_window" };
  return { startsAt, endsAt: alignedEnd };
}

export function periodStartsOnOrAfterEngine(
  settings: Pick<MinimumPayEngineSettings, "engineStartAt">,
  periodStartsAtIso: string
): boolean {
  if (!settings.engineStartAt) return false;
  const start = Date.parse(settings.engineStartAt);
  const periodStart = Date.parse(periodStartsAtIso);
  return Number.isFinite(start) && Number.isFinite(periodStart) && periodStart >= start;
}

export function existingPeriodMustBePreserved(
  existing: { id?: string; rule_version_id?: string; status?: string } | null
): boolean {
  return Boolean(existing?.id);
}

/**
 * Create at most the current period. Never pre-create an unbounded
 * chain of future windows on each cron tick.
 */
export function shouldCreatePeriodWindow(input: {
  previousEndsAtIso?: string | null;
  windowStartsAtIso: string;
  nowMs: number;
}): boolean {
  const startsAt = Date.parse(input.windowStartsAtIso);
  if (!Number.isFinite(startsAt) || startsAt > input.nowMs) return false;
  if (!input.previousEndsAtIso) return true;
  const previousEnd = Date.parse(input.previousEndsAtIso);
  return Number.isFinite(previousEnd) && previousEnd <= input.nowMs;
}

export function windowsAreContiguous(
  first: { startsAt: string; endsAt: string },
  second: { startsAt: string; endsAt: string }
): boolean {
  return first.endsAt === second.startsAt && Date.parse(second.endsAt) > Date.parse(second.startsAt);
}

/** Open sessions older than the configured stale window are closed at start + stale. */
export function resolveOnCallEndedAt(
  startedAtIso: string,
  endedAtIso: string | null,
  nowMs: number,
  staleAfterSeconds: number | null
): string | null {
  if (endedAtIso) return endedAtIso;
  if (!staleAfterSeconds || staleAfterSeconds <= 0) return null;
  const start = Date.parse(startedAtIso);
  if (!Number.isFinite(start)) return null;
  if (nowMs - start > staleAfterSeconds * 1000) {
    return new Date(start + staleAfterSeconds * 1000).toISOString();
  }
  return null;
}
