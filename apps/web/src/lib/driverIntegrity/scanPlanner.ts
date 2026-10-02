import type { DetectedAnomaly } from "./anomaly";
import { detectAnomalies } from "./anomaly";
import { decideWarningAction, pickupProgressWarningDue } from "./warningPolicy";
import { evaluateReassignmentEligibility } from "./reassignmentPolicy";
import type {
  AssignmentSnapshot,
  DriverIntegritySettings,
  GpsPoint,
  ProgressSignals,
} from "./types";
import type { WarningHistory } from "./warningPolicy";

export type ScanPlan =
  | { kind: "skip"; reason: string }
  | {
      kind: "act";
      warning: ReturnType<typeof decideWarningAction>;
      pickupWarning: boolean;
      anomalies: DetectedAnomaly[];
      reassignment: ReturnType<typeof evaluateReassignmentEligibility>;
    };

export function planIntegrityScan(input: {
  settings: DriverIntegritySettings;
  signals: ProgressSignals;
  assignment: AssignmentSnapshot;
  history: WarningHistory;
  acceptGps: GpsPoint | null;
  currentGps: GpsPoint | null;
  previousGps: GpsPoint | null;
  priorAnomalyCount: number;
}): ScanPlan {
  if (!input.settings.monitoringEnabled) {
    return { kind: "skip", reason: "monitoring_disabled" };
  }
  if (!input.assignment.driverAcceptedAt) {
    return { kind: "skip", reason: "no_server_accept_timestamp" };
  }

  const warning = decideWarningAction({
    settings: input.settings,
    signals: input.signals,
    history: input.history,
  });
  const pickupWarning = pickupProgressWarningDue({
    settings: input.settings,
    signals: input.signals,
    firstPickupWarningAtMs: null,
  });
  const anomalies = detectAnomalies({
    signals: input.signals,
    settings: input.settings,
    acceptGps: input.acceptGps,
    currentGps: input.currentGps,
    previousGps: input.previousGps,
    priorAnomalyCount: input.priorAnomalyCount,
  });
  const reassignment = evaluateReassignmentEligibility({
    settings: input.settings,
    signals: input.signals,
    assignment: input.assignment,
    expectedDriverId: input.assignment.driverId,
    firstWarningAtMs: input.history.firstWarningAtMs,
  });

  return {
    kind: "act",
    warning,
    pickupWarning,
    anomalies,
    reassignment,
  };
}
