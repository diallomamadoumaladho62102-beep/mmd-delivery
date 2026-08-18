/**
 * Pure Active Jobs visibility rules for Driver Home.
 * READ-ONLY filters — never mutate order / ride rows.
 */

export const DRIVER_TERMINAL_STATUSES = [
  "delivered",
  "canceled",
  "cancelled",
  "expired",
  "rejected",
  "refunded",
  "completed",
  "failed",
  "closed",
  "done",
] as const;

/** Assigned jobs that may still appear in Active Jobs (allowlist). */
export const DRIVER_ACTIVE_ASSIGNED_STATUSES = [
  "accepted",
  "assigned",
  "preparing",
  "prepared",
  "ready",
  "dispatched",
  "picked_up",
  "pickup",
  "on_the_way",
  "en_route",
  "in_progress",
  "driver_arrived",
  "arrived",
  "out_for_delivery",
  "dispatch_assigned",
] as const;

export type AssignedJobVisibilityRow = {
  status?: string | null;
  /** Completion timestamps (read-only) — hide from Active Jobs if set. */
  delivered_at?: string | null;
  delivered_confirmed_at?: string | null;
  dropoff_code_verified_at?: string | null;
};

export function normalizeDriverJobStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isTerminalDriverStatus(status: unknown): boolean {
  const s = normalizeDriverJobStatus(status);
  return (DRIVER_TERMINAL_STATUSES as readonly string[]).includes(s);
}

export function isActiveAssignedStatus(status: unknown): boolean {
  const s = normalizeDriverJobStatus(status);
  if (!s) return false;
  if (isTerminalDriverStatus(s)) return false;
  return (DRIVER_ACTIVE_ASSIGNED_STATUSES as readonly string[]).includes(s);
}

/** True when DB already recorded completion even if status lagging. */
export function hasCompletionSignal(row: AssignedJobVisibilityRow | null | undefined): boolean {
  if (!row) return false;
  const stamps = [row.delivered_at, row.delivered_confirmed_at, row.dropoff_code_verified_at];
  return stamps.some((v) => Boolean(String(v ?? "").trim()));
}

/** Max age for Active Jobs (display-only). Stale assigned rows stay in DB. */
export const MAX_ACTIVE_ASSIGNED_JOB_AGE_MS = 48 * 60 * 60 * 1000;

export type AssignedJobFreshnessRow = AssignedJobVisibilityRow & {
  updated_at?: string | null;
  created_at?: string | null;
};

/** Statuses that mean the driver is mid-mission — never hide for age. */
export const DRIVER_IN_PROGRESS_STATUSES = [
  "picked_up",
  "pickup",
  "on_the_way",
  "en_route",
  "in_progress",
  "driver_arrived",
  "arrived",
  "out_for_delivery",
] as const;

/**
 * True when an assigned job has not been updated recently.
 * Does not mutate DB — used to flag abandoned "ready"/"dispatched"/"accepted" zombies.
 * In-progress statuses are never considered stale by age alone.
 */
export function isStaleAssignedJob(
  row: AssignedJobFreshnessRow | null | undefined,
  nowMs: number = Date.now(),
  maxAgeMs: number = MAX_ACTIVE_ASSIGNED_JOB_AGE_MS,
): boolean {
  if (!row) return true;
  const status = normalizeDriverJobStatus(row.status);
  if ((DRIVER_IN_PROGRESS_STATUSES as readonly string[]).includes(status)) {
    return false;
  }
  const stamp = String(row.updated_at ?? row.created_at ?? "").trim();
  if (!stamp) return false; // unknown age → status allowlist only
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t > maxAgeMs;
}

/**
 * Active Jobs UI gate: allowlist status, no completion timestamp, not stale zombie.
 * Mid-mission statuses remain visible regardless of age.
 * Stale zombies remain recoverable via admin + dedicated restore paths.
 */
export function isActiveAssignedJob(
  row: AssignedJobFreshnessRow | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!row) return false;
  if (hasCompletionSignal(row)) return false;
  if (isStaleAssignedJob(row, nowMs)) return false;
  return isActiveAssignedStatus(row.status);
}

/** Backend/Admin: non-terminal assigned jobs (includes stale zombies). */
export function isRecoverableAssignedJob(
  row: AssignedJobFreshnessRow | null | undefined,
): boolean {
  if (!row) return false;
  if (hasCompletionSignal(row)) return false;
  if (isTerminalDriverStatus(row.status)) return false;
  return isActiveAssignedStatus(row.status);
}

/** UI-only earnings mask — never changes trip counts or stored money. */
export function formatHiddenEarningsLabel(
  earningsHidden: boolean,
  todayEarningsLabel: string,
): string {
  return earningsHidden ? "••••" : todayEarningsLabel;
}
