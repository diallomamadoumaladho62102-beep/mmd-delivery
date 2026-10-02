import { reassignmentIsActive } from "./engineGate";
import { hasLegitimateReportedReason, hasValidProgress } from "./progress";
import type {
  AssignmentSnapshot,
  DriverIntegritySettings,
  ProgressSignals,
} from "./types";

export type ReassignmentBlockReason =
  | "monitoring_disabled"
  | "reassignment_disabled"
  | "threshold_not_configured"
  | "warning_not_sent"
  | "valid_progress"
  | "legitimate_reason_recorded"
  | "already_reassigned"
  | "already_picked_up"
  | "already_delivered"
  | "already_cancelled"
  | "driver_mismatch"
  | "missing_assignment"
  | "stale_state"
  | "concurrent_assignment";

export type ReassignmentDecision =
  | { ok: true }
  | { ok: false; reason: ReassignmentBlockReason };

const TERMINAL_STATUSES = new Set([
  "delivered",
  "cancelled",
  "canceled",
  "completed",
  "refunded",
]);

export function evaluateReassignmentEligibility(input: {
  settings: DriverIntegritySettings;
  signals: ProgressSignals;
  assignment: AssignmentSnapshot;
  expectedDriverId: string;
  firstWarningAtMs: number | null;
}): ReassignmentDecision {
  const { settings, signals, assignment } = input;

  if (!reassignmentIsActive(settings)) {
    return { ok: false, reason: "reassignment_disabled" };
  }
  if (settings.driverNoProgressReassignmentAfterSeconds == null) {
    return { ok: false, reason: "threshold_not_configured" };
  }
  if (input.firstWarningAtMs == null) {
    return { ok: false, reason: "warning_not_sent" };
  }
  if (assignment.alreadyReassigned) {
    return { ok: false, reason: "already_reassigned" };
  }
  if (!assignment.driverId) {
    return { ok: false, reason: "missing_assignment" };
  }
  if (assignment.driverId !== input.expectedDriverId) {
    return { ok: false, reason: "driver_mismatch" };
  }
  if (assignment.pickedUpAt || signals.pickedUpAtMs) {
    return { ok: false, reason: "already_picked_up" };
  }
  if (assignment.deliveredAt || signals.deliveredAtMs) {
    return { ok: false, reason: "already_delivered" };
  }
  if (assignment.cancelledAt || signals.cancelledAtMs) {
    return { ok: false, reason: "already_cancelled" };
  }
  const status = String(assignment.status ?? "").trim().toLowerCase();
  if (TERMINAL_STATUSES.has(status)) {
    return { ok: false, reason: "stale_state" };
  }
  if (hasValidProgress(signals, settings.movementProgressThresholdMeters)) {
    return { ok: false, reason: "valid_progress" };
  }
  if (hasLegitimateReportedReason(signals.waitReasonCode)) {
    return { ok: false, reason: "legitimate_reason_recorded" };
  }
  const elapsed = Math.floor(
    (signals.nowMs - signals.driverAcceptedAtMs) / 1000
  );
  if (elapsed < settings.driverNoProgressReassignmentAfterSeconds) {
    return { ok: false, reason: "threshold_not_configured" };
  }
  return { ok: true };
}

export function reassignmentMustPreserveHistory(): {
  eraseDriverAcceptedAt: false;
  eraseOfficialTripHistory: false;
  deleteAdmissibleTime: false;
  deleteDueEarnings: false;
  modifyMinimumPayEngine: false;
} {
  return {
    eraseDriverAcceptedAt: false,
    eraseOfficialTripHistory: false,
    deleteAdmissibleTime: false,
    deleteDueEarnings: false,
    modifyMinimumPayEngine: false,
  };
}

export function doubleAssignmentForbidden(
  currentDriverId: string | null,
  nextDriverId: string | null
): boolean {
  return Boolean(
    currentDriverId && nextDriverId && currentDriverId !== nextDriverId
  );
}
