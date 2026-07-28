export const IDENTITY_SUBJECT_TYPES = [
  "driver",
  "restaurant",
  "seller",
  "business",
  "client",
  "admin",
] as const;

export type IdentitySubjectType = (typeof IDENTITY_SUBJECT_TYPES)[number];

export const IDENTITY_STATUSES = [
  "not_started",
  "pending",
  "processing",
  "verified",
  "requires_input",
  "requires_review",
  "failed",
  "canceled",
  "expired",
  "redacted",
] as const;

export type IdentityVerificationStatus = (typeof IDENTITY_STATUSES)[number];

export const IDENTITY_PROVIDERS = [
  "stripe_identity",
  "persona",
  "veriff",
  "onfido",
  "internal",
] as const;

export type IdentityProviderId = (typeof IDENTITY_PROVIDERS)[number];

export type IdentityVerificationPolicy = {
  id: string;
  subject_type: IdentitySubjectType;
  feature_key: string;
  enabled: boolean;
  required: boolean;
  provider: IdentityProviderId | string;
  verification_type: "document" | "id_number";
  require_matching_selfie: boolean;
  require_live_capture: boolean;
  require_id_number: boolean;
  max_attempts: number;
  validity_days: number | null;
  block_online: boolean;
  block_payouts: boolean;
  block_publish: boolean;
  block_activation: boolean;
  metadata: Record<string, unknown>;
};

export type IdentityVerificationRow = {
  id: string;
  subject_user_id: string;
  subject_type: IdentitySubjectType;
  feature_key: string;
  provider: string;
  verification_status: IdentityVerificationStatus;
  active_session_id: string | null;
  verification_id: string | null;
  verification_started_at: string | null;
  verification_completed_at: string | null;
  verification_failed_reason: string | null;
  verified_at: string | null;
  requires_review: boolean;
  review_reason: string | null;
  verification_attempts: number;
  stripe_connect_account_id: string | null;
  stripe_related_person_id: string | null;
  last_error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CreateIdentitySessionInput = {
  subjectUserId: string;
  subjectType: IdentitySubjectType;
  featureKey?: string;
  email?: string | null;
  phone?: string | null;
  returnUrl?: string | null;
  adminRequested?: boolean;
  requestedByAdminId?: string | null;
};

export type CreateIdentitySessionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  verificationId?: string;
  sessionId?: string;
  url?: string | null;
  clientSecret?: string | null;
  ephemeralKeySecret?: string | null;
  status?: IdentityVerificationStatus;
  provider?: string;
};

export type IdentityStatusResult = {
  ok: true;
  subjectType: IdentitySubjectType;
  featureKey: string;
  required: boolean;
  enabled: boolean;
  provider: string;
  status: IdentityVerificationStatus;
  verified: boolean;
  canProceed: boolean;
  blockOnline: boolean;
  blockPayouts: boolean;
  blockPublish: boolean;
  blockActivation: boolean;
  attempts: number;
  maxAttempts: number;
  failedReason: string | null;
  requiresReview: boolean;
  activeSessionId: string | null;
  verifiedAt: string | null;
  verification: IdentityVerificationRow | null;
};

export type ProviderCreateSessionParams = {
  subjectUserId: string;
  subjectType: IdentitySubjectType;
  featureKey: string;
  email?: string | null;
  phone?: string | null;
  returnUrl?: string | null;
  verificationType: "document" | "id_number";
  requireMatchingSelfie: boolean;
  requireLiveCapture: boolean;
  requireIdNumber: boolean;
  stripeConnectAccountId?: string | null;
  stripeRelatedPersonId?: string | null;
  metadata?: Record<string, string>;
};

export type ProviderCreateSessionResult = {
  sessionId: string;
  url: string | null;
  clientSecret: string | null;
  ephemeralKeySecret: string | null;
  status: string;
  raw: Record<string, unknown>;
};

export type ProviderSessionSnapshot = {
  sessionId: string;
  status: string;
  lastErrorCode: string | null;
  lastErrorReason: string | null;
  verificationReportId: string | null;
  raw: Record<string, unknown>;
};
