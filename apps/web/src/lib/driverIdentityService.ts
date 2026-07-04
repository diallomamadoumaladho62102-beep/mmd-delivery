import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateIdentityTriggers,
  computeVerificationExpiry,
  hashIp,
} from "@/lib/driverIdentityRiskEngine";
import {
  buildSelfieStoragePath,
  identityBlocksOnline,
  IDENTITY_SELFIE_BUCKET,
  type DriverIdentityCheckRow,
  type DriverIdentityGateStatus,
  type DriverIdentitySettings,
  type DriverIdentityStateRow,
  type DriverIdentityStatusResponse,
  type IdentityEvaluateContext,
} from "@/lib/driverIdentityTypes";

const ACTIVE_CHECK_STATUSES = new Set([
  "required",
  "pending",
  "submitted",
  "manual_review",
]);

function hashDeviceId(deviceId: string | null | undefined): string | null {
  const clean = String(deviceId ?? "").trim();
  if (!clean) return null;
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `dev_${(hash >>> 0).toString(16)}`;
}

async function logEvent(
  admin: SupabaseClient,
  driverId: string,
  checkId: string | null,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  await admin.from("driver_identity_events").insert({
    driver_id: driverId,
    check_id: checkId,
    event_type: eventType,
    metadata,
  });
}

export async function loadIdentitySettings(
  admin: SupabaseClient,
): Promise<DriverIdentitySettings> {
  const { data, error } = await admin
    .from("driver_identity_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("driver_identity_settings_missing");
  return data as DriverIdentitySettings;
}

async function loadOrCreateState(
  admin: SupabaseClient,
  driverId: string,
): Promise<DriverIdentityStateRow> {
  const { data: existing } = await admin
    .from("driver_identity_state")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (existing) return existing as DriverIdentityStateRow;

  const row = {
    driver_id: driverId,
    gate_status: "not_required" as DriverIdentityGateStatus,
  };

  const { data, error } = await admin
    .from("driver_identity_state")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return data as DriverIdentityStateRow;
}

async function loadActiveCheck(
  admin: SupabaseClient,
  checkId: string | null,
): Promise<DriverIdentityCheckRow | null> {
  if (!checkId) return null;
  const { data, error } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .maybeSingle();
  if (error) throw error;
  return (data as DriverIdentityCheckRow) ?? null;
}

async function syncStateGate(
  admin: SupabaseClient,
  driverId: string,
  gateStatus: DriverIdentityGateStatus,
  activeCheckId: string | null,
  patch: Partial<DriverIdentityStateRow> = {},
) {
  const { error } = await admin
    .from("driver_identity_state")
    .update({
      gate_status: gateStatus,
      active_check_id: activeCheckId,
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq("driver_id", driverId);

  if (error) throw error;
}

function gateMessage(
  gateStatus: DriverIdentityGateStatus,
  reason: string | null,
): string | null {
  switch (gateStatus) {
    case "required":
    case "pending":
      return reason ?? "Identity verification is required before going online.";
    case "submitted":
      return "Your selfie was submitted. Please wait while we verify your identity.";
    case "manual_review":
      return "Your verification is under manual review. You will be notified once complete.";
    case "rejected":
      return "Your identity verification was rejected. Please submit a new selfie.";
    case "expired":
      return "Your previous verification expired. Please verify your identity again.";
    case "verified":
    case "not_required":
    case "canceled":
      return null;
    default:
      return reason;
  }
}

async function isKnownDevice(
  admin: SupabaseClient,
  driverId: string,
  deviceHash: string | null,
): Promise<boolean> {
  if (!deviceHash) return true;
  const { data } = await admin
    .from("driver_identity_devices")
    .select("id")
    .eq("driver_id", driverId)
    .eq("device_id_hash", deviceHash)
    .maybeSingle();
  return Boolean(data?.id);
}

async function upsertDevice(
  admin: SupabaseClient,
  driverId: string,
  deviceHash: string | null,
  city: string | null,
  country: string | null,
) {
  if (!deviceHash) return;
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("driver_identity_devices")
    .select("id")
    .eq("driver_id", driverId)
    .eq("device_id_hash", deviceHash)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("driver_identity_devices")
      .update({ last_seen_at: now, last_city: city, last_country: country })
      .eq("id", existing.id);
    return;
  }

  await admin.from("driver_identity_devices").insert({
    driver_id: driverId,
    device_id_hash: deviceHash,
    last_city: city,
    last_country: country,
    first_seen_at: now,
    last_seen_at: now,
  });
}

async function hasOpenReport(admin: SupabaseClient, driverId: string): Promise<boolean> {
  const { data } = await admin
    .from("driver_identity_reports")
    .select("id")
    .eq("driver_id", driverId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function loadDriverProfileFlags(admin: SupabaseClient, driverId: string) {
  const { data: profile } = await admin
    .from("driver_profiles")
    .select("status, updated_at, phone, city, state")
    .eq("user_id", driverId)
    .maybeSingle();

  const { data: photoDoc } = await admin
    .from("driver_documents")
    .select("updated_at, created_at")
    .eq("user_id", driverId)
    .eq("doc_type", "profile_photo")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const state = await loadOrCreateState(admin, driverId);
  const profileWasSuspended = profile?.status === "suspended";

  const photoUpdatedAt = photoDoc?.updated_at ?? photoDoc?.created_at ?? null;
  const profilePhotoChangedRecently =
    Boolean(photoUpdatedAt && state.last_verified_at) &&
    new Date(photoUpdatedAt).getTime() > new Date(state.last_verified_at!).getTime();

  const phoneChangedRecently =
    Boolean(profile?.phone && state.last_verified_at) &&
    Boolean(profile?.updated_at) &&
    new Date(profile!.updated_at!).getTime() > new Date(state.last_verified_at!).getTime();

  return {
    profileWasSuspended: profile?.status === "suspended",
    profilePhotoChangedRecently,
    phoneChangedRecently,
    profileCity: profile?.city ?? null,
    profileCountry: profile?.state ?? null,
  };
}

async function createIdentityCheck(
  admin: SupabaseClient,
  settings: DriverIdentitySettings,
  driverId: string,
  decision: {
    triggerType: string;
    reason: string;
    riskScore: number;
    requiresManualReview: boolean;
  },
  context: IdentityEvaluateContext,
): Promise<DriverIdentityCheckRow> {
  const deviceHash = hashDeviceId(context.deviceIdHash ?? null);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const { data, error } = await admin
    .from("driver_identity_checks")
    .insert({
      driver_id: driverId,
      status: "required",
      trigger_type: decision.triggerType,
      reason: decision.reason,
      device_id_hash: deviceHash,
      city: context.city ?? null,
      country: context.country ?? null,
      ip_hash: context.ipHash ?? null,
      risk_score: decision.riskScore,
      requires_manual_review: decision.requiresManualReview,
      provider: settings.default_provider,
      expires_at: expiresAt.toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;

  await syncStateGate(admin, driverId, "required", data.id);
  await logEvent(admin, driverId, data.id, "check_created", {
    trigger_type: decision.triggerType,
    reason: decision.reason,
    risk_score: decision.riskScore,
  });

  return data as DriverIdentityCheckRow;
}

function verificationExpired(
  settings: DriverIdentitySettings,
  state: DriverIdentityStateRow,
): boolean {
  if (!state.last_verified_at) return false;
  const verifiedAt = new Date(state.last_verified_at);
  const expiry = new Date(verifiedAt);
  expiry.setDate(expiry.getDate() + settings.verification_validity_days);
  return Date.now() > expiry.getTime();
}

export async function evaluateDriverIdentity(
  admin: SupabaseClient,
  context: IdentityEvaluateContext,
): Promise<DriverIdentityStatusResponse> {
  const settings = await loadIdentitySettings(admin);
  const state = await loadOrCreateState(admin, context.driverId);
  const deviceHash = hashDeviceId(context.deviceIdHash ?? null);

  if (context.intent === "go_online" || context.intent === "refresh") {
    await upsertDevice(admin, context.driverId, deviceHash, context.city ?? null, context.country ?? null);
  }

  let activeCheck = await loadActiveCheck(admin, state.active_check_id);

  if (activeCheck && activeCheck.status === "required" && activeCheck.expires_at) {
    if (new Date(activeCheck.expires_at).getTime() < Date.now()) {
      await admin
        .from("driver_identity_checks")
        .update({ status: "expired" })
        .eq("id", activeCheck.id);
      await logEvent(admin, context.driverId, activeCheck.id, "check_expired", {});
      activeCheck = { ...activeCheck, status: "expired" };
      await syncStateGate(admin, context.driverId, "expired", null);
    }
  }

  if (
    state.gate_status === "verified" &&
    verificationExpired(settings, state)
  ) {
    await syncStateGate(admin, context.driverId, "expired", null);
    state.gate_status = "expired";
  }

  const blockingStatuses = new Set([
    "required",
    "pending",
    "submitted",
    "manual_review",
    "rejected",
    "expired",
  ]);

  if (
    activeCheck &&
    ACTIVE_CHECK_STATUSES.has(activeCheck.status) &&
    blockingStatuses.has(state.gate_status)
  ) {
    const gateStatus = state.gate_status;
    return {
      ok: true,
      gateStatus,
      canGoOnline: !identityBlocksOnline(gateStatus),
      activeCheck,
      message: gateMessage(gateStatus, activeCheck.reason),
      reason: activeCheck.reason,
    };
  }

  if (context.intent === "refresh" && state.gate_status === "verified") {
    return {
      ok: true,
      gateStatus: "verified",
      canGoOnline: true,
      activeCheck: null,
      message: null,
      reason: null,
    };
  }

  const flags = await loadDriverProfileFlags(admin, context.driverId);
  const knownDevice = await isKnownDevice(admin, context.driverId, deviceHash);
  const openReport = await hasOpenReport(admin, context.driverId);

  const evaluateContext: IdentityEvaluateContext = {
    ...context,
    city: context.city ?? flags.profileCity,
    country: context.country ?? flags.profileCountry,
    ipHash: context.ipHash ?? hashIp(null),
  };

  const decision = evaluateIdentityTriggers({
    settings,
    state,
    context: evaluateContext,
    hasOpenReport: openReport,
    isKnownDevice: knownDevice,
    profileWasSuspended: flags.profileWasSuspended,
    profilePhotoChangedRecently: flags.profilePhotoChangedRecently,
    phoneChangedRecently: flags.phoneChangedRecently,
    pendingPostSuspensionCheck: Boolean(state.pending_post_suspension_check),
  });

  if (!decision) {
    if (state.gate_status !== "verified" && state.gate_status !== "not_required") {
      await syncStateGate(admin, context.driverId, "not_required", null);
    }
    return {
      ok: true,
      gateStatus: "not_required",
      canGoOnline: true,
      activeCheck: null,
      message: null,
      reason: null,
    };
  }

  if (context.intent === "go_online" || context.intent === "admin") {
    const check = await createIdentityCheck(admin, settings, context.driverId, decision, {
      ...context,
      deviceIdHash: deviceHash,
    });

    return {
      ok: true,
      gateStatus: "required",
      canGoOnline: false,
      activeCheck: check,
      message: gateMessage("required", check.reason),
      reason: check.reason,
    };
  }

  return {
    ok: true,
    gateStatus: state.gate_status,
    canGoOnline: !identityBlocksOnline(state.gate_status),
    activeCheck,
    message: gateMessage(state.gate_status, activeCheck?.reason ?? null),
    reason: activeCheck?.reason ?? null,
  };
}

export async function registerSelfieUpload(
  admin: SupabaseClient,
  driverId: string,
  checkId: string,
  selfiePath: string,
): Promise<DriverIdentityCheckRow> {
  const { data: check, error: loadErr } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .eq("driver_id", driverId)
    .maybeSingle();

  if (loadErr) throw loadErr;
  if (!check) throw new Error("check_not_found");
  if (!["required", "pending", "rejected"].includes(check.status)) {
    throw new Error("check_not_uploadable");
  }

  const { data, error } = await admin
    .from("driver_identity_checks")
    .update({
      selfie_path: selfiePath,
      status: "pending",
    })
    .eq("id", checkId)
    .select("*")
    .single();

  if (error) throw error;

  await syncStateGate(admin, driverId, "pending", checkId);
  await logEvent(admin, driverId, checkId, "selfie_uploaded", { selfie_path: selfiePath });

  return data as DriverIdentityCheckRow;
}

export async function submitDriverIdentityCheck(
  admin: SupabaseClient,
  driverId: string,
  checkId: string,
): Promise<DriverIdentityCheckRow> {
  const { data: check, error: loadErr } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .eq("driver_id", driverId)
    .maybeSingle();

  if (loadErr) throw loadErr;
  if (!check) throw new Error("check_not_found");
  if (!check.selfie_path) throw new Error("selfie_missing");
  if (!["required", "pending"].includes(check.status)) {
    throw new Error("check_not_submittable");
  }

  const nextStatus = check.requires_manual_review ? "manual_review" : "submitted";
  const gateStatus: DriverIdentityGateStatus = check.requires_manual_review
    ? "manual_review"
    : "submitted";

  const { data, error } = await admin
    .from("driver_identity_checks")
    .update({
      status: nextStatus,
      submitted_at: new Date().toISOString(),
      confidence_score: 75,
    })
    .eq("id", checkId)
    .select("*")
    .single();

  if (error) throw error;

  await syncStateGate(admin, driverId, gateStatus, checkId);
  await logEvent(admin, driverId, checkId, "check_submitted", {
    requires_manual_review: check.requires_manual_review,
  });

  if (!check.requires_manual_review) {
    await autoApproveIfEligible(admin, driverId, checkId);
    const refreshed = await loadActiveCheck(admin, checkId);
    return refreshed ?? (data as DriverIdentityCheckRow);
  }

  return data as DriverIdentityCheckRow;
}

async function autoApproveIfEligible(
  admin: SupabaseClient,
  driverId: string,
  checkId: string,
) {
  const settings = await loadIdentitySettings(admin);
  const { data: check } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .maybeSingle();

  if (!check || check.requires_manual_review) return;
  if (Number(check.risk_score) >= settings.manual_review_risk_threshold) return;

  await adminReviewIdentityCheck(admin, {
    checkId,
    adminUserId: null,
    action: "approve",
    reviewNotes: "Auto-approved (low risk, manual review not required).",
    suspendDriver: false,
  });
}

export type AdminReviewAction = "approve" | "reject" | "request_new_photo" | "suspend";

export async function adminReviewIdentityCheck(
  admin: SupabaseClient,
  input: {
    checkId: string;
    adminUserId: string | null;
    action: AdminReviewAction;
    reviewNotes?: string | null;
    suspendDriver?: boolean;
  },
): Promise<DriverIdentityCheckRow> {
  const { data: check, error: loadErr } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", input.checkId)
    .maybeSingle();

  if (loadErr) throw loadErr;
  if (!check) throw new Error("check_not_found");

  const driverId = check.driver_id;
  const now = new Date().toISOString();
  const notes = input.reviewNotes?.trim() || null;

  if (input.action === "approve") {
    const { data, error } = await admin
      .from("driver_identity_checks")
      .update({
        status: "verified",
        verified_at: now,
        reviewed_by: input.adminUserId,
        review_notes: notes,
      })
      .eq("id", input.checkId)
      .select("*")
      .single();
    if (error) throw error;

    const settings = await loadIdentitySettings(admin);
    const state = await loadOrCreateState(admin, driverId);
    const threshold =
      state.next_random_ride_threshold ??
      Math.floor(
        settings.random_min_rides +
          Math.random() * (settings.random_max_rides - settings.random_min_rides + 1),
      );

    await syncStateGate(admin, driverId, "verified", null, {
      last_verified_at: now,
      rides_since_verification: 0,
      next_random_ride_threshold: threshold,
      last_device_id_hash: check.device_id_hash,
      last_city: check.city,
      last_country: check.country,
      pending_post_suspension_check: false,
    });

    await admin
      .from("driver_identity_reports")
      .update({ status: "reviewed", reviewed_at: now, reviewed_by: input.adminUserId })
      .eq("driver_id", driverId)
      .eq("status", "open");

    await logEvent(admin, driverId, input.checkId, "check_approved", { notes });
    return data as DriverIdentityCheckRow;
  }

  if (input.action === "reject") {
    const { data, error } = await admin
      .from("driver_identity_checks")
      .update({
        status: "rejected",
        rejected_at: now,
        reviewed_by: input.adminUserId,
        review_notes: notes,
      })
      .eq("id", input.checkId)
      .select("*")
      .single();
    if (error) throw error;

    await syncStateGate(admin, driverId, "rejected", input.checkId);
    await logEvent(admin, driverId, input.checkId, "check_rejected", { notes });
    return data as DriverIdentityCheckRow;
  }

  if (input.action === "request_new_photo") {
    const { data, error } = await admin
      .from("driver_identity_checks")
      .update({
        status: "required",
        selfie_path: null,
        submitted_at: null,
        review_notes: notes,
        reviewed_by: input.adminUserId,
      })
      .eq("id", input.checkId)
      .select("*")
      .single();
    if (error) throw error;

    await syncStateGate(admin, driverId, "required", input.checkId);
    await logEvent(admin, driverId, input.checkId, "new_photo_requested", { notes });
    return data as DriverIdentityCheckRow;
  }

  if (input.action === "suspend") {
    await admin
      .from("driver_profiles")
      .update({ status: "suspended", is_online: false, updated_at: now })
      .eq("user_id", driverId);

    const { data, error } = await admin
      .from("driver_identity_checks")
      .update({
        status: "rejected",
        rejected_at: now,
        reviewed_by: input.adminUserId,
        review_notes: notes ?? "Suspended after identity review.",
      })
      .eq("id", input.checkId)
      .select("*")
      .single();
    if (error) throw error;

    await syncStateGate(admin, driverId, "rejected", input.checkId);
    await logEvent(admin, driverId, input.checkId, "driver_suspended", { notes });
    return data as DriverIdentityCheckRow;
  }

  throw new Error("invalid_review_action");
}

export async function adminRequestIdentityCheck(
  admin: SupabaseClient,
  input: { driverId: string; adminUserId: string; reason?: string },
): Promise<DriverIdentityCheckRow> {
  const settings = await loadIdentitySettings(admin);
  return createIdentityCheck(
    admin,
    settings,
    input.driverId,
    {
      triggerType: "admin_manual",
      reason: input.reason?.trim() || "Manual verification requested by administrator.",
      riskScore: 90,
      requiresManualReview: true,
    },
    {
      driverId: input.driverId,
      intent: "admin",
      adminUserId: input.adminUserId,
      adminReason: input.reason,
    },
  );
}

export async function createSignedSelfieUrl(
  admin: SupabaseClient,
  path: string,
  expiresInSeconds = 300,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(IDENTITY_SELFIE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("signed_url_failed");
  return data.signedUrl;
}

export async function updateIdentitySettings(
  admin: SupabaseClient,
  patch: Partial<DriverIdentitySettings>,
  adminUserId: string,
): Promise<DriverIdentitySettings> {
  const { data, error } = await admin
    .from("driver_identity_settings")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: adminUserId,
    })
    .eq("id", 1)
    .select("*")
    .single();

  if (error) throw error;
  return data as DriverIdentitySettings;
}

export function resolveSelfiePathForCheck(
  driverId: string,
  checkId: string,
  ext = "jpg",
): string {
  return buildSelfieStoragePath(driverId, checkId, ext);
}

export async function recordDriverOnlineAttempt(
  admin: SupabaseClient,
  driverId: string,
) {
  await admin
    .from("driver_identity_state")
    .update({ last_online_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("driver_id", driverId);
}

export { hashDeviceId };
