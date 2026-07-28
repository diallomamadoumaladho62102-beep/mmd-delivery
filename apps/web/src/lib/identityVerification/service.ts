import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getIdentityProvider,
  loadIdentityPolicy,
  resolveConnectPersonBridge,
} from "./policies";
import { notifyIdentityStatusChange } from "./notifications";
import type {
  CreateIdentitySessionInput,
  CreateIdentitySessionResult,
  IdentityStatusResult,
  IdentitySubjectType,
  IdentityVerificationRow,
  IdentityVerificationStatus,
} from "./types";

export function mapStripeStatusToMmd(status: string): IdentityVerificationStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "verified":
      return "verified";
    case "processing":
      return "processing";
    case "requires_input":
      return "requires_input";
    case "canceled":
      return "canceled";
    case "redacted":
      return "redacted";
    default:
      return "pending";
  }
}

async function writeAuditEvent(
  supabase: SupabaseClient,
  input: {
    verificationId?: string | null;
    attemptId?: string | null;
    subjectUserId?: string | null;
    eventSource: string;
    eventType: string;
    provider?: string | null;
    providerEventId?: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<{ inserted: boolean; duplicate: boolean }> {
  const { error } = await supabase.from("identity_verification_events").insert({
    verification_id: input.verificationId ?? null,
    attempt_id: input.attemptId ?? null,
    subject_user_id: input.subjectUserId ?? null,
    event_source: input.eventSource,
    event_type: input.eventType,
    provider: input.provider ?? null,
    provider_event_id: input.providerEventId ?? null,
    payload: input.payload ?? {},
  });

  if (!error) return { inserted: true, duplicate: false };

  const code = String((error as { code?: string }).code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  if (code === "23505" || message.includes("duplicate")) {
    return { inserted: false, duplicate: true };
  }

  console.warn("[identityVerification.writeAuditEvent]", error);
  return { inserted: false, duplicate: false };
}

async function ensureVerificationRow(
  supabase: SupabaseClient,
  subjectUserId: string,
  subjectType: IdentitySubjectType,
  featureKey: string,
  provider: string
): Promise<IdentityVerificationRow> {
  const { data: existing, error } = await supabase
    .from("identity_verifications")
    .select("*")
    .eq("subject_user_id", subjectUserId)
    .eq("subject_type", subjectType)
    .eq("feature_key", featureKey)
    .maybeSingle();

  if (error) throw error;
  if (existing) return existing as IdentityVerificationRow;

  const { data: created, error: insertError } = await supabase
    .from("identity_verifications")
    .insert({
      subject_user_id: subjectUserId,
      subject_type: subjectType,
      feature_key: featureKey,
      provider,
      verification_status: "not_started",
    })
    .select("*")
    .single();

  if (!insertError && created) {
    return created as IdentityVerificationRow;
  }

  const code = String((insertError as { code?: string } | null)?.code ?? "");
  if (code === "23505") {
    const { data: raced, error: raceError } = await supabase
      .from("identity_verifications")
      .select("*")
      .eq("subject_user_id", subjectUserId)
      .eq("subject_type", subjectType)
      .eq("feature_key", featureKey)
      .maybeSingle();
    if (raceError) throw raceError;
    if (raced) return raced as IdentityVerificationRow;
  }

  throw insertError ?? new Error("identity_verification_row_create_failed");
}

function toPublicStatus(
  result: Omit<IdentityStatusResult, "verification"> & {
    verification?: IdentityVerificationRow | null;
  }
): IdentityStatusResult {
  // Never expose internal metadata / admin ids / Connect internals to clients.
  const { verification: _omit, ...publicFields } = result;
  return {
    ...publicFields,
    verification: null,
  };
}

export async function getIdentityStatus(
  supabase: SupabaseClient,
  subjectUserId: string,
  subjectType: IdentitySubjectType,
  featureKey = "default"
): Promise<IdentityStatusResult> {
  const policy = await loadIdentityPolicy(supabase, subjectType, featureKey);
  const enabled = Boolean(policy?.enabled);
  const required = Boolean(policy?.enabled && policy?.required);
  const provider = String(policy?.provider ?? "stripe_identity");

  const { data } = await supabase
    .from("identity_verifications")
    .select("*")
    .eq("subject_user_id", subjectUserId)
    .eq("subject_type", subjectType)
    .eq("feature_key", featureKey)
    .maybeSingle();

  const verification = (data as IdentityVerificationRow | null) ?? null;
  const status = verification?.verification_status ?? "not_started";
  const verified = status === "verified";
  const canProceed = !required || verified;

  return toPublicStatus({
    ok: true,
    subjectType,
    featureKey,
    required,
    enabled,
    provider,
    status,
    verified,
    canProceed,
    blockOnline: Boolean(policy?.block_online),
    blockPayouts: Boolean(policy?.block_payouts),
    blockPublish: Boolean(policy?.block_publish),
    blockActivation: Boolean(policy?.block_activation),
    attempts: verification?.verification_attempts ?? 0,
    maxAttempts: policy?.max_attempts ?? 5,
    failedReason: verification?.verification_failed_reason ?? null,
    requiresReview: Boolean(verification?.requires_review),
    activeSessionId: verification?.active_session_id ?? null,
    verifiedAt: verification?.verified_at ?? null,
    verification,
  });
}

export async function createIdentitySession(
  supabase: SupabaseClient,
  input: CreateIdentitySessionInput
): Promise<CreateIdentitySessionResult> {
  const featureKey = input.featureKey ?? "default";
  const policy = await loadIdentityPolicy(
    supabase,
    input.subjectType,
    featureKey
  );

  if (!policy || !policy.enabled) {
    return { ok: false, error: "identity_policy_disabled" };
  }

  const providerId = String(policy.provider || "stripe_identity");
  const provider = getIdentityProvider(providerId);
  const row = await ensureVerificationRow(
    supabase,
    input.subjectUserId,
    input.subjectType,
    featureKey,
    providerId
  );

  if (row.verification_status === "verified") {
    return {
      ok: true,
      verificationId: row.id,
      status: "verified",
      provider: providerId,
      message: "already_verified",
    };
  }

  // Resume an open session instead of creating duplicates when possible.
  if (
    row.active_session_id &&
    (row.verification_status === "pending" ||
      row.verification_status === "requires_input" ||
      row.verification_status === "processing")
  ) {
    try {
      const existing = await provider.retrieveSession(row.active_session_id);
      const mappedExisting = mapStripeStatusToMmd(existing.status);
      if (
        mappedExisting !== "canceled" &&
        mappedExisting !== "redacted" &&
        mappedExisting !== "verified" &&
        existing.url
      ) {
        let ephemeralKeySecret: string | null = null;
        if (typeof provider.createEphemeralKey === "function") {
          ephemeralKeySecret = await provider.createEphemeralKey(
            row.active_session_id
          );
        }
        return {
          ok: true,
          verificationId: row.id,
          sessionId: row.active_session_id,
          url: existing.url,
          ephemeralKeySecret,
          status: mappedExisting === "requires_input" ? "requires_input" : "pending",
          provider: providerId,
          message: "session_resumed",
        };
      }
    } catch (error) {
      console.warn("[identityVerification] resume session failed; creating new", error);
    }
  }

  if (row.verification_attempts >= policy.max_attempts) {
    return {
      ok: false,
      error: "max_attempts_reached",
      message: "Maximum identity verification attempts reached. Contact support.",
    };
  }

  const bridge = await resolveConnectPersonBridge(
    supabase,
    input.subjectUserId,
    input.subjectType
  );

  const created = await provider.createSession({
    subjectUserId: input.subjectUserId,
    subjectType: input.subjectType,
    featureKey,
    email: input.email,
    phone: input.phone,
    returnUrl: input.returnUrl,
    verificationType: policy.verification_type,
    requireMatchingSelfie: policy.require_matching_selfie,
    requireLiveCapture: policy.require_live_capture,
    requireIdNumber: policy.require_id_number,
    stripeConnectAccountId: bridge.accountId,
    stripeRelatedPersonId: bridge.personId,
    metadata: {
      admin_requested: input.adminRequested ? "true" : "false",
    },
  });

  const mappedStatus = mapStripeStatusToMmd(created.status);
  const now = new Date().toISOString();

  const { data: attempt, error: attemptError } = await supabase
    .from("identity_verification_attempts")
    .insert({
      verification_id: row.id,
      subject_user_id: input.subjectUserId,
      subject_type: input.subjectType,
      provider: providerId,
      verification_session_id: created.sessionId,
      status: mappedStatus,
      started_at: now,
      metadata: {
        url_present: Boolean(created.url),
        admin_requested: Boolean(input.adminRequested),
      },
    })
    .select("id")
    .single();

  if (attemptError) throw attemptError;

  const { error: updateError } = await supabase
    .from("identity_verifications")
    .update({
      provider: providerId,
      verification_status: mappedStatus === "requires_input" ? "pending" : mappedStatus,
      active_session_id: created.sessionId,
      verification_started_at: row.verification_started_at ?? now,
      verification_attempts: row.verification_attempts + 1,
      stripe_connect_account_id: bridge.accountId,
      stripe_related_person_id: bridge.personId,
      verification_failed_reason: null,
      last_error_code: null,
      metadata: {
        ...(row.metadata ?? {}),
        last_session_created_at: now,
        requested_by_admin_id: input.requestedByAdminId ?? null,
      },
    })
    .eq("id", row.id);

  if (updateError) throw updateError;

  await writeAuditEvent(supabase, {
    verificationId: row.id,
    attemptId: attempt?.id ?? null,
    subjectUserId: input.subjectUserId,
    eventSource: input.adminRequested ? "admin" : "api",
    eventType: "session.created",
    provider: providerId,
    payload: {
      session_id: created.sessionId,
      subject_type: input.subjectType,
      feature_key: featureKey,
    },
  });

  await notifyIdentityStatusChange(supabase, {
    subjectUserId: input.subjectUserId,
    subjectType: input.subjectType,
    status: "pending",
    reason: "verification_started",
    dedupeSuffix: `session:${created.sessionId}:started`,
    notifyAdmins: Boolean(input.adminRequested),
  });

  // Public client contract: sessionId + hosted url + optional ephemeral key only.
  // Never return Stripe VerificationSession client_secret to mobile.
  return {
    ok: true,
    verificationId: row.id,
    sessionId: created.sessionId,
    url: created.url,
    ephemeralKeySecret: created.ephemeralKeySecret,
    status: "pending",
    provider: providerId,
  };
}

export async function applyProviderSessionSnapshot(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    providerStatus: string;
    lastErrorCode?: string | null;
    lastErrorReason?: string | null;
    verificationReportId?: string | null;
    providerEventId?: string | null;
    eventType?: string | null;
    raw?: Record<string, unknown>;
  }
): Promise<{
  ok: boolean;
  verificationId?: string;
  status?: IdentityVerificationStatus;
  duplicate?: boolean;
}> {
  const providerEventId = String(input.providerEventId ?? "").trim() || null;

  // Idempotency short-circuit: same Stripe event already applied.
  if (providerEventId) {
    const { data: existingEvent } = await supabase
      .from("identity_verification_events")
      .select("id, verification_id")
      .eq("provider", "stripe_identity")
      .eq("provider_event_id", providerEventId)
      .limit(1);
    if ((existingEvent ?? []).length > 0) {
      return {
        ok: true,
        duplicate: true,
        verificationId: existingEvent?.[0]?.verification_id ?? undefined,
        status: mapStripeStatusToMmd(input.providerStatus),
      };
    }
  }

  const mapped = mapStripeStatusToMmd(input.providerStatus);
  const now = new Date().toISOString();

  const { data: attempt } = await supabase
    .from("identity_verification_attempts")
    .select("id, verification_id, subject_user_id, subject_type, provider")
    .eq("verification_session_id", input.sessionId)
    .maybeSingle();

  let verificationId = attempt?.verification_id as string | undefined;
  let subjectUserId = attempt?.subject_user_id as string | undefined;
  let subjectType = attempt?.subject_type as IdentitySubjectType | undefined;
  const provider = String(attempt?.provider ?? "stripe_identity");

  if (!verificationId) {
    const { data: byActive } = await supabase
      .from("identity_verifications")
      .select("*")
      .eq("active_session_id", input.sessionId)
      .maybeSingle();
    if (byActive) {
      verificationId = byActive.id;
      subjectUserId = byActive.subject_user_id;
      subjectType = byActive.subject_type as IdentitySubjectType;
    }
  }

  if (!verificationId || !subjectUserId || !subjectType) {
    return { ok: false };
  }

  const patch: Record<string, unknown> = {
    verification_status:
      mapped === "requires_input" ? "requires_input" : mapped,
    active_session_id: input.sessionId,
    last_error_code: input.lastErrorCode ?? null,
    verification_failed_reason: input.lastErrorReason ?? null,
  };

  if (mapped === "verified") {
    patch.verified_at = now;
    patch.verification_completed_at = now;
    patch.requires_review = false;
    patch.review_reason = null;
    patch.verification_id = input.verificationReportId ?? input.sessionId;
  }

  if (mapped === "requires_input" || mapped === "failed" || mapped === "canceled") {
    patch.verification_completed_at = now;
  }

  if (mapped === "requires_input" && input.lastErrorCode) {
    patch.requires_review = false;
  }

  await supabase.from("identity_verifications").update(patch).eq("id", verificationId);

  if (attempt?.id) {
    await supabase
      .from("identity_verification_attempts")
      .update({
        status: mapped,
        completed_at: now,
        failed_reason: input.lastErrorReason ?? null,
        error_code: input.lastErrorCode ?? null,
        provider_verification_report_id: input.verificationReportId ?? null,
      })
      .eq("id", attempt.id);
  }

  const audit = await writeAuditEvent(supabase, {
    verificationId,
    attemptId: attempt?.id ?? null,
    subjectUserId,
    eventSource: "webhook",
    eventType: input.eventType ?? `session.${mapped}`,
    provider,
    providerEventId,
    payload: {
      session_id: input.sessionId,
      provider_status: input.providerStatus,
      mapped_status: mapped,
    },
  });

  // If another worker won the audit unique race, skip side-effect notifications.
  if (audit.duplicate) {
    return { ok: true, duplicate: true, verificationId, status: mapped };
  }

  const shouldNotify =
    mapped === "verified" ||
    mapped === "requires_input" ||
    mapped === "failed" ||
    mapped === "canceled" ||
    mapped === "processing" ||
    mapped === "redacted";

  if (shouldNotify) {
    await notifyIdentityStatusChange(supabase, {
      subjectUserId,
      subjectType,
      status: mapped,
      reason: input.lastErrorReason ?? mapped,
      dedupeSuffix:
        providerEventId ?? `session:${input.sessionId}:${mapped}`,
      notifyAdmins:
        mapped === "verified" ||
        mapped === "requires_input" ||
        mapped === "failed" ||
        mapped === "canceled" ||
        mapped === "redacted",
    });
  }

  // Intentionally do NOT write driver_identity_state here.
  // Legacy selfie / risk gate remains independent of Stripe Identity KYC.

  return { ok: true, verificationId, status: mapped };
}

export async function adminRequestReverification(
  supabase: SupabaseClient,
  input: {
    subjectUserId: string;
    subjectType: IdentitySubjectType;
    featureKey?: string;
    adminUserId: string;
    reason?: string | null;
  }
): Promise<CreateIdentitySessionResult> {
  const featureKey = input.featureKey ?? "default";
  const row = await ensureVerificationRow(
    supabase,
    input.subjectUserId,
    input.subjectType,
    featureKey,
    "stripe_identity"
  );

  // Cancel open Stripe session when present (best-effort).
  if (row.active_session_id) {
    try {
      const provider = getIdentityProvider("stripe_identity");
      if (typeof provider.cancelSession === "function") {
        await provider.cancelSession(row.active_session_id);
      }
    } catch (error) {
      console.warn("[identityVerification] cancel before reverify failed", error);
    }
  }

  await supabase
    .from("identity_verifications")
    .update({
      verification_status: "not_started",
      verified_at: null,
      active_session_id: null,
      verification_attempts: 0,
      requires_review: false,
      review_reason: input.reason ?? "admin_reverification",
      verification_failed_reason: null,
      last_error_code: null,
    })
    .eq("id", row.id);

  await writeAuditEvent(supabase, {
    verificationId: row.id,
    subjectUserId: input.subjectUserId,
    eventSource: "admin",
    eventType: "admin.reverification_requested",
    payload: {
      admin_user_id: input.adminUserId,
      reason: input.reason ?? null,
    },
  });

  return createIdentitySession(supabase, {
    subjectUserId: input.subjectUserId,
    subjectType: input.subjectType,
    featureKey,
    adminRequested: true,
    requestedByAdminId: input.adminUserId,
  });
}
