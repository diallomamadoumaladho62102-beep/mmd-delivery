import {
  reassignmentIsActive,
  reviewIsActive,
  warningNotificationsAreActive,
} from "./engineGate";
import {
  hasLegitimateReportedReason,
  hasPickupProgress,
  hasTerminalState,
  hasValidProgress,
} from "./progress";
import type { DriverIntegritySettings, ProgressSignals } from "./types";

export type WarningDecision =
  | { action: "none"; reason: string }
  | { action: "first_warning"; reason: string }
  | { action: "final_warning"; reason: string }
  | { action: "reassign"; reason: string }
  | { action: "open_review"; reason: string };

export type WarningHistory = {
  firstWarningAtMs: number | null;
  finalWarningAtMs: number | null;
  reassignedAtMs: number | null;
  reviewOpenedAtMs: number | null;
};

export function decideWarningAction(input: {
  settings: DriverIntegritySettings;
  signals: ProgressSignals;
  history: WarningHistory;
}): WarningDecision {
  const { settings, signals, history } = input;
  const elapsed = Math.floor(
    (signals.nowMs - signals.driverAcceptedAtMs) / 1000
  );

  if (!settings.monitoringEnabled) {
    return { action: "none", reason: "monitoring_disabled" };
  }
  if (hasTerminalState(signals)) {
    return { action: "none", reason: "terminal_state" };
  }
  if (hasPickupProgress(signals)) {
    return { action: "none", reason: "already_picked_up" };
  }
  if (history.reassignedAtMs != null) {
    return { action: "none", reason: "already_reassigned" };
  }
  if (hasValidProgress(signals, settings.movementProgressThresholdMeters)) {
    return { action: "none", reason: "valid_progress" };
  }
  if (hasLegitimateReportedReason(signals.waitReasonCode)) {
    if (
      reviewIsActive(settings) &&
      settings.driverNoProgressReviewAfterSeconds != null &&
      elapsed >= settings.driverNoProgressReviewAfterSeconds &&
      history.reviewOpenedAtMs == null
    ) {
      return { action: "open_review", reason: "review_after_reported_reason" };
    }
    return { action: "none", reason: "legitimate_reason_recorded" };
  }

  if (
    warningNotificationsAreActive(settings) &&
    settings.driverAcceptanceWarningAfterSeconds != null &&
    elapsed >= settings.driverAcceptanceWarningAfterSeconds &&
    history.firstWarningAtMs == null
  ) {
    return { action: "first_warning", reason: "no_progress_after_accept" };
  }

  const reassignmentDue =
    reassignmentIsActive(settings) &&
    settings.driverNoProgressReassignmentAfterSeconds != null &&
    elapsed >= settings.driverNoProgressReassignmentAfterSeconds &&
    history.firstWarningAtMs != null;

  if (
    reassignmentDue &&
    warningNotificationsAreActive(settings) &&
    history.finalWarningAtMs == null
  ) {
    return { action: "final_warning", reason: "pre_reassignment_warning" };
  }

  if (
    reassignmentDue &&
    (history.finalWarningAtMs != null || !warningNotificationsAreActive(settings))
  ) {
    return { action: "reassign", reason: "no_progress_timeout" };
  }

  if (
    reviewIsActive(settings) &&
    settings.driverNoProgressReviewAfterSeconds != null &&
    elapsed >= settings.driverNoProgressReviewAfterSeconds &&
    history.reviewOpenedAtMs == null
  ) {
    return { action: "open_review", reason: "no_progress_review_timeout" };
  }

  return { action: "none", reason: "thresholds_not_met_or_null" };
}

export function pickupProgressWarningDue(input: {
  settings: DriverIntegritySettings;
  signals: ProgressSignals;
  firstPickupWarningAtMs: number | null;
}): boolean {
  const { settings, signals } = input;
  if (!warningNotificationsAreActive(settings)) return false;
  if (input.firstPickupWarningAtMs != null) return false;
  if (!signals.arrivedAtMs && !signals.waitTimerStartedAtMs) return false;
  if (signals.pickedUpAtMs != null) return false;
  if (settings.driverPickupProgressWarningAfterSeconds == null) return false;
  const start = signals.arrivedAtMs ?? signals.waitTimerStartedAtMs;
  if (start == null) return false;
  const elapsed = Math.floor((signals.nowMs - start) / 1000);
  return elapsed >= settings.driverPickupProgressWarningAfterSeconds;
}
