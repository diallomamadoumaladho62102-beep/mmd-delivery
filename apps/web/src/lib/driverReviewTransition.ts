import { canReviewDrivers } from "./adminAccess";
import { effectiveStaffRole } from "./adminRbac";

export const DRIVER_REVIEW_TARGETS = [
  "approved",
  "rejected",
  "suspended",
  "disabled",
] as const;

export type DriverReviewTarget = (typeof DRIVER_REVIEW_TARGETS)[number];

export const REJECTION_NOTE_MIN_LENGTH = 8;
export const DRIVER_DECISION_NOTE_MAX_LENGTH = 500;

const INSERT_IGNORED_STATUSES = [
  "approved",
  "rejected",
  "suspended",
  "disabled",
  "pending",
  "incomplete",
] as const;

export function forceOwnerInsertStatus(requested: unknown): "pending" {
  void requested;
  return "pending";
}

export function ownerInsertIgnoresClientStatus(requested: unknown): boolean {
  const value = String(requested ?? "").trim().toLowerCase();
  return (
    forceOwnerInsertStatus(requested) === "pending" &&
    (INSERT_IGNORED_STATUSES as readonly string[]).includes(value)
  );
}

/** Statuses from which an admin decision may move. One UPDATE ... IN (...) wins. */
export function allowedSourceStatuses(
  target: DriverReviewTarget,
): readonly string[] {
  switch (target) {
    case "approved":
      return ["pending", "incomplete", "suspended", "disabled"];
    case "rejected":
      return ["pending", "incomplete"];
    case "suspended":
      return ["approved"];
    case "disabled":
      return ["approved"];
  }
}

export function isDriverReviewTarget(value: unknown): value is DriverReviewTarget {
  return (
    value === "approved" ||
    value === "rejected" ||
    value === "suspended" ||
    value === "disabled"
  );
}

export type ReviewClaim =
  | { ok: true; from: string; to: DriverReviewTarget }
  | { ok: false; error: "already_reviewed" | "review_conflict" };

/**
 * Compare-and-swap result for one review.
 * approved ↔ rejected is refused. A second action on the same status is already_reviewed.
 */
export function claimReviewTransition(
  current: string | null | undefined,
  requested: DriverReviewTarget,
): ReviewClaim {
  const status = String(current ?? "").trim().toLowerCase();
  if (allowedSourceStatuses(requested).includes(status)) {
    return { ok: true, from: status, to: requested };
  }
  if (status === requested) {
    return { ok: false, error: "already_reviewed" };
  }
  return { ok: false, error: "review_conflict" };
}

export function sanitizeDriverDecisionNote(value: unknown): string {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DRIVER_DECISION_NOTE_MAX_LENGTH);
}

export function rejectionNoteError(
  status: DriverReviewTarget,
  note: unknown,
): "rejection_reason_required" | null {
  if (status !== "rejected") return null;
  if (sanitizeDriverDecisionNote(note).length < REJECTION_NOTE_MIN_LENGTH) {
    return "rejection_reason_required";
  }
  return null;
}

export function decisionNoteForStatus(
  status: DriverReviewTarget,
  note: unknown,
): string | null {
  if (status === "approved") return null;
  const clean = sanitizeDriverDecisionNote(note);
  return clean.length > 0 ? clean : null;
}

export function decisionEventKey(params: {
  from: string;
  to: string;
  reviewedAt: string;
}): string {
  return `decision:${params.from}->${params.to}:${params.reviewedAt}`;
}

export const PENDING_SIGNUP_ALERT_KEY = "awaiting:signup";

export function resubmitAlertKey(updatedAt: string): string {
  return `awaiting:resubmit:${updatedAt}`;
}

/** Super Admin, Operations Admin, Review Admin, and founders. Not Finance or Support. */
export function isDriverReviewerAccount(
  role: unknown,
  isFounder: boolean,
): boolean {
  const staff = effectiveStaffRole({ role, isFounder });
  return canReviewDrivers(staff);
}

export type ReviewStore = {
  status: string;
  notifications: string[];
};

export type SimulatedReview =
  | { ok: true; notified: true; error?: undefined }
  | { ok: false; notified: false; error: "already_reviewed" | "review_conflict" };

/**
 * Serialized CAS. Postgres row locks make two concurrent reviews behave like
 * these two calls: the second observes the committed status.
 */
export function applyReviewClaim(
  store: ReviewStore,
  requested: DriverReviewTarget,
  reviewedAt: string,
): SimulatedReview {
  const claim = claimReviewTransition(store.status, requested);
  if (claim.ok === false) {
    return { ok: false, notified: false, error: claim.error };
  }
  const key = decisionEventKey({
    from: claim.from,
    to: claim.to,
    reviewedAt,
  });
  if (store.notifications.includes(key)) {
    return { ok: false, notified: false, error: "review_conflict" };
  }
  store.status = claim.to;
  store.notifications.push(key);
  return { ok: true, notified: true };
}
