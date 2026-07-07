export const DRIVER_IDENTITY_CHECK_STATUSES = [
  "required",
  "pending",
  "submitted",
  "verified",
  "rejected",
  "manual_review",
  "expired",
  "canceled",
] as const;

export const DRIVER_IDENTITY_GATE_STATUSES = [
  "not_required",
  "required",
  "pending",
  "submitted",
  "verified",
  "rejected",
  "manual_review",
  "expired",
  "canceled",
] as const;

export const DRIVER_IDENTITY_TRIGGER_TYPES = [
  "first_online",
  "new_device",
  "city_change",
  "country_change",
  "inactivity",
  "random",
  "client_report",
  "suspicious_behavior",
  "phone_change",
  "profile_photo_change",
  "post_suspension",
  "periodic",
  "admin_manual",
] as const;

export type DriverIdentityCheckStatus = (typeof DRIVER_IDENTITY_CHECK_STATUSES)[number];
export type DriverIdentityGateStatus = (typeof DRIVER_IDENTITY_GATE_STATUSES)[number];
export type DriverIdentityTriggerType = (typeof DRIVER_IDENTITY_TRIGGER_TYPES)[number];

export type DriverIdentitySettings = {
  id: number;
  random_check_enabled: boolean;
  random_min_rides: number;
  random_max_rides: number;
  require_on_new_device: boolean;
  require_after_inactivity_days: number;
  require_on_city_change: boolean;
  require_on_country_change: boolean;
  require_on_report: boolean;
  require_on_first_online: boolean;
  require_on_profile_photo_change: boolean;
  require_on_phone_change: boolean;
  require_after_suspension: boolean;
  periodic_check_enabled: boolean;
  periodic_check_days: number;
  manual_review_enabled: boolean;
  manual_review_risk_threshold: number;
  verification_validity_days: number;
  retention_days: number;
  default_provider: string;
  sla_warning_minutes?: number;
  sla_critical_minutes?: number;
  lock_ttl_minutes?: number;
};

export type DriverIdentityStateRow = {
  driver_id: string;
  gate_status: DriverIdentityGateStatus;
  active_check_id: string | null;
  last_verified_at: string | null;
  last_device_id_hash: string | null;
  last_city: string | null;
  last_country: string | null;
  rides_since_verification: number;
  last_online_at: string | null;
  next_random_ride_threshold: number | null;
  pending_post_suspension_check?: boolean;
};

export type DriverIdentityCheckRow = {
  id: string;
  driver_id: string;
  status: DriverIdentityCheckStatus;
  trigger_type: DriverIdentityTriggerType;
  reason: string | null;
  selfie_path: string | null;
  device_id_hash: string | null;
  city: string | null;
  country: string | null;
  ip_hash: string | null;
  confidence_score: number | null;
  risk_score: number;
  requires_manual_review: boolean;
  provider: string;
  provider_reference: string | null;
  expires_at: string | null;
  created_at: string;
  submitted_at: string | null;
  verified_at: string | null;
  rejected_at: string | null;
  reviewed_by: string | null;
  review_notes: string | null;
};

export type IdentityEvaluateContext = {
  driverId: string;
  deviceIdHash?: string | null;
  city?: string | null;
  country?: string | null;
  ipHash?: string | null;
  intent: "go_online" | "refresh" | "admin";
  adminUserId?: string | null;
  adminReason?: string | null;
};

export type IdentityTriggerDecision = {
  triggerType: DriverIdentityTriggerType;
  reason: string;
  riskScore: number;
  requiresManualReview: boolean;
};

export type DriverIdentityStatusResponse = {
  ok: true;
  gateStatus: DriverIdentityGateStatus;
  canGoOnline: boolean;
  activeCheck: DriverIdentityCheckRow | null;
  message: string | null;
  reason: string | null;
};

export const IDENTITY_SELFIE_BUCKET = "driver-identity-selfies";

export function identityBlocksOnline(gateStatus: DriverIdentityGateStatus): boolean {
  return [
    "required",
    "pending",
    "submitted",
    "manual_review",
    "rejected",
    "expired",
  ].includes(gateStatus);
}

export function buildSelfieStoragePath(driverId: string, checkId: string, ext = "jpg"): string {
  return `drivers/${driverId}/${checkId}.${ext}`;
}
