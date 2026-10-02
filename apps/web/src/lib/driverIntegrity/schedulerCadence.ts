/**
 * Driver Integrity infrastructure cadence.
 *
 * GitHub Actions is the supported runner (same pattern as production-dispatch-crons).
 * GitHub documents a 5-minute minimum for scheduled workflows; shorter expressions
 * are not a guaranteed interval. Vercel Hobby is daily-only. pg_cron is reserved
 * for in-database jobs and must not hold CRON_SECRET.
 *
 * Business thresholds stay in Admin (nullable seconds). The scan compares
 * server now() against driver_accepted_at — a 5-minute tick still fires the
 * first time elapsed >= threshold. Never hardcode 1/2/5/10 minutes as a rule.
 */
export const GITHUB_ACTIONS_MIN_SCHEDULE_MINUTES = 5;

export const DRIVER_INTEGRITY_CRON_EXPRESSION = "*/5 * * * *";

/** Must stay below the 5-minute schedule so a timed-out worker cannot block the next tick forever. */
export const DRIVER_INTEGRITY_LOCK_TTL_SECONDS = 240;

export function isSupportedGithubActionsSchedule(expression: string): boolean {
  const parts = String(expression ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute] = parts;
  const step = /^(\*|0)\/(\d+)$/.exec(minute);
  if (!step) return false;
  const minutes = Number(step[2]);
  return Number.isInteger(minutes) && minutes >= GITHUB_ACTIONS_MIN_SCHEDULE_MINUTES;
}

export function lockTtlFitsSchedule(
  ttlSeconds: number,
  scheduleMinutes = GITHUB_ACTIONS_MIN_SCHEDULE_MINUTES
): boolean {
  return ttlSeconds > 0 && ttlSeconds < scheduleMinutes * 60;
}
