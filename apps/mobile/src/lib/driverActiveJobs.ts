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

/**
 * Active Jobs gate: allowlist status AND no completion timestamp.
 * Terminal / completed jobs must never appear.
 */
export function isActiveAssignedJob(row: AssignedJobVisibilityRow | null | undefined): boolean {
  if (!row) return false;
  if (hasCompletionSignal(row)) return false;
  return isActiveAssignedStatus(row.status);
}

/** UI-only earnings mask — never changes trip counts or stored money. */
export function formatHiddenEarningsLabel(
  earningsHidden: boolean,
  todayEarningsLabel: string,
): string {
  return earningsHidden ? "••••" : todayEarningsLabel;
}
