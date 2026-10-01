import type {
  DriverIntegrityCase,
  DriverWaitReasonCode,
  ProgressSignals,
} from "./types";

export function elapsedSeconds(fromMs: number, nowMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(nowMs) || nowMs < fromMs) {
    return 0;
  }
  return Math.floor((nowMs - fromMs) / 1000);
}

export function hasTerminalState(signals: ProgressSignals): boolean {
  return signals.deliveredAtMs != null || signals.cancelledAtMs != null;
}

export function hasPickupProgress(signals: ProgressSignals): boolean {
  return signals.pickedUpAtMs != null;
}

export function hasArrivalProgress(signals: ProgressSignals): boolean {
  return signals.arrivedAtMs != null || signals.waitTimerStartedAtMs != null;
}

export function hasGpsMovementProgress(
  signals: Pick<ProgressSignals, "gpsAvailable" | "metersFromAccept">,
  movementThresholdMeters: number | null
): boolean {
  if (!signals.gpsAvailable) return false;
  if (movementThresholdMeters == null) return false;
  if (signals.metersFromAccept == null) return false;
  return signals.metersFromAccept >= movementThresholdMeters;
}

export function hasValidProgress(
  signals: ProgressSignals,
  movementThresholdMeters: number | null
): boolean {
  if (hasTerminalState(signals) || hasPickupProgress(signals)) return true;
  if (hasArrivalProgress(signals)) return true;
  return hasGpsMovementProgress(signals, movementThresholdMeters);
}

export function hasLegitimateReportedReason(
  code: DriverWaitReasonCode | null
): boolean {
  return code != null;
}

export function classifyIntegrityCase(
  signals: ProgressSignals,
  movementThresholdMeters: number | null
): DriverIntegrityCase {
  if (signals.waitReasonCode === "restaurant_delay") return "restaurant_delay";
  if (signals.waitReasonCode === "order_issue") return "order_issue";
  if (signals.waitReasonCode === "technical_issue") return "technical_issue";
  if (
    signals.waitReasonCode === "traffic" ||
    signals.waitReasonCode === "vehicle_issue" ||
    signals.waitReasonCode === "safety_issue" ||
    signals.waitReasonCode === "other"
  ) {
    return "other_legitimate";
  }
  if (hasArrivalProgress(signals) && !hasPickupProgress(signals)) {
    return "arrived_no_pickup";
  }
  if (
    hasGpsMovementProgress(signals, movementThresholdMeters) &&
    !hasArrivalProgress(signals)
  ) {
    return "moving_not_arrived";
  }
  if (!signals.gpsAvailable && !hasArrivalProgress(signals)) {
    return "gps_unavailable";
  }
  return "no_movement";
}
