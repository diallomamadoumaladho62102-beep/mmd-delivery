/**
 * Detect abandoned/stale assigned driver jobs for Admin ops.
 * READ-ONLY helpers — never mutate order/ride status here.
 */

export const STALE_ASSIGNED_JOB_AGE_MS = 48 * 60 * 60 * 1000;

export type StaleJobCandidate = {
  id: string;
  service: "food" | "delivery" | "taxi" | "marketplace";
  status: string;
  driver_id: string | null;
  updated_at: string | null;
  created_at: string | null;
  driver_payout_label?: string | null;
};

/** Mid-mission: not "stale abandoned" even if old. */
const IN_PROGRESS = new Set([
  "picked_up",
  "pickup",
  "on_the_way",
  "en_route",
  "in_progress",
  "driver_arrived",
  "arrived",
  "out_for_delivery",
]);

const TERMINAL = new Set([
  "delivered",
  "completed",
  "canceled",
  "cancelled",
  "expired",
  "rejected",
  "refunded",
  "failed",
  "closed",
  "done",
]);

export function normalizeJobStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Abandoned assigned job: non-terminal, not mid-mission, last update older than maxAge.
 * Examples: food stuck at `ready`, delivery stuck at `dispatched`.
 */
export function isAbandonedStaleAssignedJob(
  row: {
    status?: string | null;
    updated_at?: string | null;
    created_at?: string | null;
  },
  nowMs: number = Date.now(),
  maxAgeMs: number = STALE_ASSIGNED_JOB_AGE_MS,
): boolean {
  const status = normalizeJobStatus(row.status);
  if (!status || TERMINAL.has(status)) return false;
  if (IN_PROGRESS.has(status)) return false;
  const stamp = String(row.updated_at ?? row.created_at ?? "").trim();
  if (!stamp) return false;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t > maxAgeMs;
}

export function staleJobAgeHours(
  row: { updated_at?: string | null; created_at?: string | null },
  nowMs: number = Date.now(),
): number | null {
  const stamp = String(row.updated_at ?? row.created_at ?? "").trim();
  if (!stamp) return null;
  const t = new Date(stamp).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / (60 * 60 * 1000));
}

/** Recommended Admin action hint (not auto-applied). */
export function suggestedAdminActionForStaleJob(status: unknown): string {
  const s = normalizeJobStatus(status);
  if (s === "ready" || s === "accepted" || s === "dispatched" || s === "assigned") {
    return "review_then_cancel_or_force_complete";
  }
  if (IN_PROGRESS.has(s)) {
    return "force_complete_or_investigate";
  }
  return "review";
}
