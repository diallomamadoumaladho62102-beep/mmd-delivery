import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminReviewAction } from "@/lib/driverIdentityService";
import { adminReviewIdentityCheck, loadIdentitySettings } from "@/lib/driverIdentityService";
import { STAFF_ROLES } from "@/lib/adminRbac";
import { normalizeUserRole, type UserRole } from "@/lib/roles";

export type IdentitySlaSettings = {
  sla_warning_minutes: number;
  sla_critical_minutes: number;
  lock_ttl_minutes: number;
};

export type IdentityCheckOpsRow = {
  id: string;
  driver_id: string;
  status: string;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  review_started_at: string | null;
  decision_change_count: number;
  created_at: string;
  submitted_at: string | null;
  requires_manual_review: boolean;
  risk_score: number;
  reviewed_by: string | null;
};

export type IdentityDecisionRow = {
  id: string;
  check_id: string;
  driver_id: string;
  actor_user_id: string | null;
  action: AdminReviewAction;
  previous_status: string | null;
  new_status: string;
  review_started_at: string | null;
  processing_duration_ms: number | null;
  decision_change_index: number;
  notes: string | null;
  created_at: string;
};

const WAITING_STATUSES = ["required", "pending", "submitted", "manual_review"];

export class IdentityCheckLockError extends Error {
  status: number;
  lockedBy: string | null;

  constructor(message: string, status = 409, lockedBy: string | null = null) {
    super(message);
    this.name = "IdentityCheckLockError";
    this.status = status;
    this.lockedBy = lockedBy;
  }
}

export async function loadIdentitySlaSettings(
  admin: SupabaseClient,
): Promise<IdentitySlaSettings> {
  const settings = await loadIdentitySettings(admin);
  return {
    sla_warning_minutes: Number(settings.sla_warning_minutes ?? 30),
    sla_critical_minutes: Number(settings.sla_critical_minutes ?? 120),
    lock_ttl_minutes: Number(settings.lock_ttl_minutes ?? 15),
  };
}

function isLockActive(row: IdentityCheckOpsRow, now = Date.now()): boolean {
  if (!row.locked_by || !row.lock_expires_at) return false;
  return new Date(row.lock_expires_at).getTime() > now;
}

export async function acquireIdentityCheckLock(
  admin: SupabaseClient,
  checkId: string,
  staffUserId: string,
): Promise<IdentityCheckOpsRow> {
  const sla = await loadIdentitySlaSettings(admin);
  const { data: check, error } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .maybeSingle();

  if (error) throw error;
  if (!check) throw new Error("check_not_found");

  const row = check as IdentityCheckOpsRow;
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(
    now.getTime() + sla.lock_ttl_minutes * 60 * 1000,
  ).toISOString();

  if (isLockActive(row) && row.locked_by !== staffUserId) {
    throw new IdentityCheckLockError(
      "Ce dossier est en cours de traitement par un autre agent.",
      409,
      row.locked_by,
    );
  }

  const patch = {
    locked_by: staffUserId,
    locked_at: nowIso,
    lock_expires_at: expiresIso,
    review_started_at: row.review_started_at ?? nowIso,
  };

  const { data, error: updateError } = await admin
    .from("driver_identity_checks")
    .update(patch)
    .eq("id", checkId)
    .select("*")
    .single();

  if (updateError) throw updateError;
  return data as IdentityCheckOpsRow;
}

export async function releaseIdentityCheckLock(
  admin: SupabaseClient,
  checkId: string,
  staffUserId: string,
  force = false,
): Promise<void> {
  const { data: check } = await admin
    .from("driver_identity_checks")
    .select("locked_by")
    .eq("id", checkId)
    .maybeSingle();

  if (!check) return;
  if (!force && check.locked_by && check.locked_by !== staffUserId) {
    throw new IdentityCheckLockError(
      "Impossible de libérer un verrou détenu par un autre agent.",
      409,
      check.locked_by,
    );
  }

  await admin
    .from("driver_identity_checks")
    .update({
      locked_by: null,
      locked_at: null,
      lock_expires_at: null,
    })
    .eq("id", checkId);
}

export async function assertIdentityCheckLockForReview(
  admin: SupabaseClient,
  checkId: string,
  staffUserId: string,
): Promise<void> {
  const { data: check } = await admin
    .from("driver_identity_checks")
    .select("locked_by, lock_expires_at")
    .eq("id", checkId)
    .maybeSingle();

  if (!check) throw new Error("check_not_found");

  const row = check as Pick<IdentityCheckOpsRow, "locked_by" | "lock_expires_at">;
  if (!isLockActive(row as IdentityCheckOpsRow)) {
    await acquireIdentityCheckLock(admin, checkId, staffUserId);
    return;
  }

  if (row.locked_by !== staffUserId) {
    throw new IdentityCheckLockError(
      "Ce dossier est verrouillé par un autre agent.",
      409,
      row.locked_by,
    );
  }
}

export async function assignIdentityCheck(
  admin: SupabaseClient,
  checkId: string,
  assigneeUserId: string,
  assignedByUserId: string,
): Promise<IdentityCheckOpsRow> {
  const nowIso = new Date().toISOString();
  const { data: assigneeProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", assigneeUserId)
    .maybeSingle();

  const assigneeRole = normalizeUserRole(assigneeProfile?.role);
  if (!assigneeRole || !STAFF_ROLES.includes(assigneeRole as (typeof STAFF_ROLES)[number])) {
    throw new Error("invalid_assignee");
  }

  const { data, error } = await admin
    .from("driver_identity_checks")
    .update({
      assigned_to: assigneeUserId,
      assigned_by: assignedByUserId,
      assigned_at: nowIso,
    })
    .eq("id", checkId)
    .select("*")
    .single();

  if (error) throw error;
  return data as IdentityCheckOpsRow;
}

function startOfUtcDay(date = new Date()): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString();
}

export async function recordIdentityDecision(
  admin: SupabaseClient,
  input: {
    checkBefore: IdentityCheckOpsRow;
    checkAfter: IdentityCheckOpsRow;
    actorUserId: string;
    action: AdminReviewAction;
    notes?: string | null;
  },
): Promise<IdentityDecisionRow> {
  const startedAt =
    input.checkBefore.review_started_at ??
    input.checkBefore.submitted_at ??
    input.checkBefore.created_at;
  const startedMs = new Date(startedAt).getTime();
  const processingDurationMs = Number.isNaN(startedMs)
    ? null
    : Math.max(0, Date.now() - startedMs);

  const previousDecisionCount = Number(input.checkBefore.decision_change_count ?? 0);
  const statusChanged = input.checkBefore.status !== input.checkAfter.status;
  const nextDecisionIndex = statusChanged
    ? previousDecisionCount + 1
    : Math.max(1, previousDecisionCount);

  const { data, error } = await admin
    .from("driver_identity_decisions")
    .insert({
      check_id: input.checkAfter.id,
      driver_id: input.checkAfter.driver_id,
      actor_user_id: input.actorUserId,
      action: input.action,
      previous_status: input.checkBefore.status,
      new_status: input.checkAfter.status,
      review_started_at: input.checkBefore.review_started_at,
      processing_duration_ms: processingDurationMs,
      decision_change_index: nextDecisionIndex,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error) throw error;

  if (statusChanged) {
    await admin
      .from("driver_identity_checks")
      .update({ decision_change_count: nextDecisionIndex })
      .eq("id", input.checkAfter.id);
  }

  return data as IdentityDecisionRow;
}

export async function adminReviewIdentityCheckWithOps(
  admin: SupabaseClient,
  input: {
    checkId: string;
    adminUserId: string;
    action: AdminReviewAction;
    reviewNotes?: string | null;
    suspendDriver?: boolean;
  },
) {
  await assertIdentityCheckLockForReview(admin, input.checkId, input.adminUserId);

  const { data: checkBefore, error: beforeError } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", input.checkId)
    .maybeSingle();

  if (beforeError) throw beforeError;
  if (!checkBefore) throw new Error("check_not_found");

  const checkAfter = await adminReviewIdentityCheck(admin, {
    checkId: input.checkId,
    adminUserId: input.adminUserId,
    action: input.action,
    reviewNotes: input.reviewNotes,
    suspendDriver: input.suspendDriver,
  });

  const decision = await recordIdentityDecision(admin, {
    checkBefore: checkBefore as IdentityCheckOpsRow,
    checkAfter: checkAfter as unknown as IdentityCheckOpsRow,
    actorUserId: input.adminUserId,
    action: input.action,
    notes: input.reviewNotes,
  });

  await releaseIdentityCheckLock(admin, input.checkId, input.adminUserId, true);

  return { check: checkAfter, decision };
}

export async function getIdentityQueueMetrics(admin: SupabaseClient) {
  const todayStart = startOfUtcDay();

  const { count: waitingCount } = await admin
    .from("driver_identity_checks")
    .select("*", { count: "exact", head: true })
    .in("status", WAITING_STATUSES);

  const { count: manualReviewCount } = await admin
    .from("driver_identity_checks")
    .select("*", { count: "exact", head: true })
    .or("requires_manual_review.eq.true,status.eq.manual_review")
    .in("status", WAITING_STATUSES);

  const { count: highRiskCount } = await admin
    .from("driver_identity_checks")
    .select("*", { count: "exact", head: true })
    .gte("risk_score", 61)
    .in("status", WAITING_STATUSES);

  const { count: processedTodayCount } = await admin
    .from("driver_identity_decisions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart);

  return {
    waiting: waitingCount ?? 0,
    manual_review: manualReviewCount ?? 0,
    high_risk: highRiskCount ?? 0,
    processed_today: processedTodayCount ?? 0,
  };
}

export async function getIdentityOpsStats(admin: SupabaseClient) {
  const sla = await loadIdentitySlaSettings(admin);
  const todayStart = startOfUtcDay();
  const last30Start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: decisions } = await admin
    .from("driver_identity_decisions")
    .select("actor_user_id, action, processing_duration_ms, created_at")
    .gte("created_at", last30Start);

  const rows = decisions ?? [];
  const total = rows.length;
  const approveCount = rows.filter((row) => row.action === "approve").length;
  const rejectCount = rows.filter((row) => row.action === "reject").length;

  const durations = rows
    .map((row) => Number(row.processing_duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const avgReviewMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0;

  const byAgent = new Map<string, number>();
  for (const row of rows) {
    const actor = String(row.actor_user_id ?? "unknown");
    byAgent.set(actor, (byAgent.get(actor) ?? 0) + 1);
  }

  const { count: expiredCount } = await admin
    .from("driver_identity_checks")
    .select("*", { count: "exact", head: true })
    .eq("status", "expired");

  const slaCompliant = rows.filter((row) => {
    const durationMin = Number(row.processing_duration_ms ?? 0) / 60000;
    return durationMin <= sla.sla_critical_minutes;
  }).length;

  const { count: todayDecisions } = await admin
    .from("driver_identity_decisions")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart);

  return {
    avg_review_ms: avgReviewMs,
    avg_review_minutes: Math.round(avgReviewMs / 60000),
    approval_rate: total > 0 ? Math.round((approveCount / total) * 100) : 0,
    rejection_rate: total > 0 ? Math.round((rejectCount / total) * 100) : 0,
    expired_count: expiredCount ?? 0,
    sla_compliance_rate: total > 0 ? Math.round((slaCompliant / total) * 100) : 100,
    processed_today: todayDecisions ?? 0,
    decisions_last_30_days: total,
    dossiers_by_agent: [...byAgent.entries()].map(([agent_user_id, count]) => ({
      agent_user_id,
      count,
    })),
    sla_settings: sla,
  };
}

export async function listIdentityStaffAssignees(admin: SupabaseClient) {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, role, full_name, email")
    .in("role", [...STAFF_ROLES]);

  return (profiles ?? [])
    .map((profile) => ({
      id: String(profile.id),
      role: normalizeUserRole(profile.role) as UserRole,
      full_name: profile.full_name ?? null,
      email: profile.email ?? null,
    }))
    .filter((profile) => profile.role && STAFF_ROLES.includes(profile.role as (typeof STAFF_ROLES)[number]));
}

export async function loadIdentityDecisionsForCheck(
  admin: SupabaseClient,
  checkId: string,
): Promise<IdentityDecisionRow[]> {
  const { data, error } = await admin
    .from("driver_identity_decisions")
    .select("*")
    .eq("check_id", checkId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as IdentityDecisionRow[];
}

export async function loadStaffNameMap(
  admin: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);

  const map = new Map<string, string>();
  for (const profile of profiles ?? []) {
    const label =
      String(profile.full_name ?? "").trim() ||
      String(profile.email ?? "").trim() ||
      String(profile.id);
    map.set(String(profile.id), label);
  }
  return map;
}

export { WAITING_STATUSES };
