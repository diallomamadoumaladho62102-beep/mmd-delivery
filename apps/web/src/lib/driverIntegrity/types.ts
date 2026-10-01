export const DRIVER_INTEGRITY_ENTITY_TYPES = [
  "order",
  "delivery_request",
] as const;
export type DriverIntegrityEntityType =
  (typeof DRIVER_INTEGRITY_ENTITY_TYPES)[number];

export const DRIVER_WAIT_REASON_CODES = [
  "restaurant_delay",
  "order_issue",
  "traffic",
  "gps_issue",
  "technical_issue",
  "vehicle_issue",
  "safety_issue",
  "other",
] as const;
export type DriverWaitReasonCode = (typeof DRIVER_WAIT_REASON_CODES)[number];

export const DRIVER_INTEGRITY_ANOMALY_TYPES = [
  "no_progress",
  "long_trip",
  "stationary",
  "gps_inconsistent",
  "gps_unavailable",
  "impossible_speed",
  "incoherent_events",
  "incoherent_timestamps",
  "incoherent_server_state",
  "restaurant_wait_review",
  "repeated_anomalies",
] as const;
export type DriverIntegrityAnomalyType =
  (typeof DRIVER_INTEGRITY_ANOMALY_TYPES)[number];

export const DRIVER_INTEGRITY_SEVERITIES = [
  "info",
  "low",
  "medium",
  "high",
] as const;
export type DriverIntegritySeverity =
  (typeof DRIVER_INTEGRITY_SEVERITIES)[number];

export const DRIVER_INTEGRITY_INCIDENT_STATUSES = [
  "open",
  "warning",
  "final_warning",
  "reassigned",
  "review",
  "confirmed",
  "not_confirmed",
  "policy_action",
  "closed",
] as const;
export type DriverIntegrityIncidentStatus =
  (typeof DRIVER_INTEGRITY_INCIDENT_STATUSES)[number];

export const DRIVER_INTEGRITY_WARNING_KINDS = ["first", "final"] as const;
export type DriverIntegrityWarningKind =
  (typeof DRIVER_INTEGRITY_WARNING_KINDS)[number];

export const DRIVER_INTEGRITY_REVIEW_DECISIONS = [
  "confirmed",
  "not_confirmed",
] as const;
export type DriverIntegrityReviewDecision =
  (typeof DRIVER_INTEGRITY_REVIEW_DECISIONS)[number];

export const DRIVER_INTEGRITY_POLICY_ACTIONS = [
  "warning",
  "additional_review",
  "temporary_restriction",
  "suspension",
  "none",
] as const;
export type DriverIntegrityPolicyAction =
  (typeof DRIVER_INTEGRITY_POLICY_ACTIONS)[number];

export const DRIVER_INTEGRITY_CASES = [
  "no_movement",
  "moving_not_arrived",
  "arrived_no_pickup",
  "restaurant_delay",
  "order_issue",
  "technical_issue",
  "gps_unavailable",
  "other_legitimate",
] as const;
export type DriverIntegrityCase = (typeof DRIVER_INTEGRITY_CASES)[number];

export type DriverIntegritySettings = {
  monitoringEnabled: boolean;
  warningNotificationsEnabled: boolean;
  reassignmentEnabled: boolean;
  contactEnabled: boolean;
  reviewEnabled: boolean;
  sanctionWorkflowEnabled: boolean;
  driverAcceptanceWarningAfterSeconds: number | null;
  driverNoProgressReassignmentAfterSeconds: number | null;
  driverPickupProgressWarningAfterSeconds: number | null;
  driverNoProgressReviewAfterSeconds: number | null;
  restaurantWaitReviewThresholdSeconds: number | null;
  longTripThresholdSeconds: number | null;
  stationaryThresholdSeconds: number | null;
  impossibleSpeedThresholdMps: number | null;
  gpsStaleAfterSeconds: number | null;
  gpsJumpThresholdMeters: number | null;
  movementProgressThresholdMeters: number | null;
  requireChangeReason: boolean;
};

export type GpsPoint = {
  lat: number;
  lng: number;
  atMs: number;
};

export type ProgressSignals = {
  driverAcceptedAtMs: number;
  nowMs: number;
  arrivedAtMs: number | null;
  waitTimerStartedAtMs: number | null;
  pickedUpAtMs: number | null;
  deliveredAtMs: number | null;
  cancelledAtMs: number | null;
  locationUpdatedAtMs: number | null;
  metersFromAccept: number | null;
  gpsAvailable: boolean;
  gpsStale: boolean;
  waitReasonCode: DriverWaitReasonCode | null;
};

export type AssignmentSnapshot = {
  entityType: DriverIntegrityEntityType;
  entityId: string;
  driverId: string;
  status: string;
  driverAcceptedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  alreadyReassigned: boolean;
};

export const DEFAULT_DRIVER_INTEGRITY_SETTINGS: DriverIntegritySettings = {
  monitoringEnabled: false,
  warningNotificationsEnabled: false,
  reassignmentEnabled: false,
  contactEnabled: false,
  reviewEnabled: false,
  sanctionWorkflowEnabled: false,
  driverAcceptanceWarningAfterSeconds: null,
  driverNoProgressReassignmentAfterSeconds: null,
  driverPickupProgressWarningAfterSeconds: null,
  driverNoProgressReviewAfterSeconds: null,
  restaurantWaitReviewThresholdSeconds: null,
  longTripThresholdSeconds: null,
  stationaryThresholdSeconds: null,
  impossibleSpeedThresholdMps: null,
  gpsStaleAfterSeconds: null,
  gpsJumpThresholdMeters: null,
  movementProgressThresholdMeters: null,
  requireChangeReason: true,
};
