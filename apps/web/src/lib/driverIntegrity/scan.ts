import type { SupabaseClient } from "@supabase/supabase-js";
import { acquireCronJobLock, releaseCronJobLock } from "@/lib/cronJobLock";
import { detectAnomalies } from "./anomaly";
import { failClosedScanSkipReason } from "./engineGate";
import { haversineMeters } from "./gpsIntegrity";
import { notifyDriverIntegrityWarning } from "./notify";
import { elapsedSeconds } from "./progress";
import { evaluateReassignmentEligibility } from "./reassignmentPolicy";
import { loadDriverIntegritySettings } from "./settingsStore";
import { planIntegrityScan } from "./scanPlanner";
import type {
  AssignmentSnapshot,
  DriverIntegrityEntityType,
  DriverIntegritySettings,
  DriverWaitReasonCode,
  GpsPoint,
  ProgressSignals,
} from "./types";
import { parseWaitReasonCode } from "./waitReasons";
import { decideWarningAction } from "./warningPolicy";
import { DRIVER_INTEGRITY_LOCK_TTL_SECONDS } from "./schedulerCadence";
import {
  DRIVER_INTEGRITY_SCAN_PAGE_SIZE,
  loadScanCursor,
  saveScanCursor,
  type ScanCursor,
} from "./scanCursor";
import { CRON_JOB_BUDGET_MS, isDeadlineApproaching } from "@/lib/cronTimeouts";
import { trustedInternalOrigin } from "@/lib/productionSite";

type ScanCounters = {
  skipped: boolean;
  skipReason: string | null;
  scanned: number;
  warnings: number;
  finalWarnings: number;
  reassigned: number;
  reviewsOpened: number;
  incidentsUpserted: number;
  duplicates: number;
  truncated: boolean;
};

function asIsoMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function asCoord(lat: unknown, lng: unknown, at: unknown): GpsPoint | null {
  const a = Number(lat);
  const b = Number(lng);
  const atMs = asIsoMs(at) ?? Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b, atMs };
}

async function loadWaitReason(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType,
  entityId: string,
  driverId: string
): Promise<DriverWaitReasonCode | null> {
  const { data } = await supabase
    .from("driver_wait_reasons")
    .select("reason_code")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return parseWaitReasonCode(data?.reason_code);
}

async function upsertIncident(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ id: string; duplicate: boolean } | null> {
  const { data: existing } = await supabase
    .from("driver_integrity_incidents")
    .select("id,status,original_driver_accepted_at,original_driver_id")
    .eq("entity_type", row.entity_type)
    .eq("entity_id", row.entity_id)
    .eq("original_driver_id", row.original_driver_id)
    .not("status", "in", "(closed,policy_action)")
    .maybeSingle();

  if (existing?.id) {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      last_case: row.last_case,
      last_anomalies: row.last_anomalies,
      severity: row.severity,
      evidence: row.evidence,
    };
    if (row.status) patch.status = row.status;
    await supabase
      .from("driver_integrity_incidents")
      .update(patch)
      .eq("id", existing.id);
    return { id: String(existing.id), duplicate: true };
  }

  const { data, error } = await supabase
    .from("driver_integrity_incidents")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return null;
  return { id: String(data.id), duplicate: false };
}

async function recordEvent(
  supabase: SupabaseClient,
  incidentId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await supabase.from("driver_integrity_events").insert({
    incident_id: incidentId,
    event_type: eventType,
    payload,
  });
}

async function insertWarningIdempotent(
  supabase: SupabaseClient,
  incidentId: string,
  kind: "first" | "final"
): Promise<boolean> {
  const { error } = await supabase.from("driver_integrity_warnings").insert({
    incident_id: incidentId,
    warning_kind: kind,
  });
  if (error && /duplicate|unique|23505/i.test(error.message)) return false;
  return !error;
}

async function maybeRedispatch(
  origin: string | null,
  entityType: DriverIntegrityEntityType,
  entityId: string,
  excludeDriverId: string
) {
  if (!origin) return;
  let safeOrigin: string;
  try {
    safeOrigin = trustedInternalOrigin(origin);
  } catch {
    return;
  }
  const headers = {
    "Content-Type": "application/json",
    "x-dispatch-internal-secret":
      process.env.DISPATCH_INTERNAL_SECRET || process.env.CRON_SECRET || "",
  };
  if (!headers["x-dispatch-internal-secret"]) return;
  if (entityType === "marketplace_job") {
    return;
  }
  if (entityType === "order") {
    await fetch(`${safeOrigin}/api/dispatch/smart`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        orderId: entityId,
        wave: 1,
        excludeDriverIds: [excludeDriverId],
      }),
      cache: "no-store",
    }).catch(() => null);
    return;
  }
  await fetch(`${safeOrigin}/api/dispatch/delivery-request`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      deliveryRequestId: entityId,
      wave: 1,
      excludeDriverIds: [excludeDriverId],
    }),
    cache: "no-store",
  }).catch(() => null);
}

async function scanEntity(
  supabase: SupabaseClient,
  settings: DriverIntegritySettings,
  assignment: AssignmentSnapshot,
  nowMs: number,
  origin: string | null,
  counters: ScanCounters
) {
  counters.scanned += 1;
  const acceptedMs = asIsoMs(assignment.driverAcceptedAt);
  if (acceptedMs == null) return;

  const { data: loc } = await supabase
    .from("driver_locations")
    .select("lat,lng,updated_at")
    .eq("driver_id", assignment.driverId)
    .maybeSingle();

  const currentGps = loc
    ? asCoord(loc.lat, loc.lng, loc.updated_at)
    : null;
  const gpsAvailable = currentGps != null;
  const gpsStale =
    gpsAvailable &&
    settings.gpsStaleAfterSeconds != null &&
    elapsedSeconds(currentGps!.atMs, nowMs) >= settings.gpsStaleAfterSeconds;

  const { data: incident } = await supabase
    .from("driver_integrity_incidents")
    .select("*")
    .eq("entity_type", assignment.entityType)
    .eq("entity_id", assignment.entityId)
    .eq("original_driver_id", assignment.driverId)
    .not("status", "in", "(closed)")
    .maybeSingle();

  const acceptGps = incident
    ? asCoord(
        (incident as Record<string, unknown>).accept_lat,
        (incident as Record<string, unknown>).accept_lng,
        assignment.driverAcceptedAt
      )
    : currentGps;

  const metersFromAccept =
    acceptGps && currentGps ? haversineMeters(acceptGps, currentGps) : null;

  const waitReason = await loadWaitReason(
    supabase,
    assignment.entityType,
    assignment.entityId,
    assignment.driverId
  );

  const { data: entityRow } =
    assignment.entityType === "marketplace_job"
      ? await supabase
          .from("marketplace_delivery_jobs")
          .select("status,assigned_driver_id,driver_accepted_at,updated_at")
          .eq("id", assignment.entityId)
          .maybeSingle()
      : assignment.entityType === "order"
        ? await supabase
            .from("orders")
            .select(
              "driver_arrived_at,wait_timer_started_at,picked_up_at,delivered_at,cancelled_at,status,driver_id"
            )
            .eq("id", assignment.entityId)
            .maybeSingle()
        : await supabase
            .from("delivery_requests")
            .select(
              "driver_arrived_at,wait_timer_started_at,picked_up_at,delivered_at,cancelled_at,status,driver_id"
            )
            .eq("id", assignment.entityId)
            .maybeSingle();

  const row = (entityRow ?? {}) as Record<string, unknown>;
  const marketplaceStatus = String(row.status ?? assignment.status).toLowerCase();
  const marketplacePickedUp =
    assignment.entityType === "marketplace_job" &&
    (marketplaceStatus === "picked_up" || marketplaceStatus === "delivered")
      ? String(row.updated_at ?? "")
      : null;
  const marketplaceDelivered =
    assignment.entityType === "marketplace_job" && marketplaceStatus === "delivered"
      ? String(row.updated_at ?? "")
      : null;
  const marketplaceCancelled =
    assignment.entityType === "marketplace_job" &&
    (marketplaceStatus === "cancelled" || marketplaceStatus === "canceled")
      ? String(row.updated_at ?? "")
      : null;

  const signals: ProgressSignals = {
    driverAcceptedAtMs: acceptedMs,
    nowMs,
    arrivedAtMs: asIsoMs(row.driver_arrived_at),
    waitTimerStartedAtMs: asIsoMs(row.wait_timer_started_at),
    pickedUpAtMs: asIsoMs(
      row.picked_up_at ?? assignment.pickedUpAt ?? marketplacePickedUp
    ),
    deliveredAtMs: asIsoMs(
      row.delivered_at ?? assignment.deliveredAt ?? marketplaceDelivered
    ),
    cancelledAtMs: asIsoMs(
      row.cancelled_at ?? assignment.cancelledAt ?? marketplaceCancelled
    ),
    locationUpdatedAtMs: currentGps?.atMs ?? null,
    metersFromAccept,
    gpsAvailable,
    gpsStale,
    waitReasonCode: waitReason,
  };

  const liveAssignment: AssignmentSnapshot = {
    ...assignment,
    status: String(row.status ?? assignment.status),
    driverId: String(
      row.assigned_driver_id ?? row.driver_id ?? assignment.driverId
    ),
    pickedUpAt:
      (row.picked_up_at as string | null) ??
      assignment.pickedUpAt ??
      marketplacePickedUp,
    deliveredAt:
      (row.delivered_at as string | null) ??
      assignment.deliveredAt ??
      marketplaceDelivered,
    cancelledAt:
      (row.cancelled_at as string | null) ??
      assignment.cancelledAt ??
      marketplaceCancelled,
    alreadyReassigned: Boolean(incident?.reassigned_at),
  };

  const { data: warnings } = await supabase
    .from("driver_integrity_warnings")
    .select("warning_kind,sent_at")
    .eq("incident_id", incident?.id ?? "00000000-0000-0000-0000-000000000000");

  const first = (warnings ?? []).find((w) => w.warning_kind === "first");
  const final = (warnings ?? []).find((w) => w.warning_kind === "final");

  const { count: priorCount } = await supabase
    .from("driver_integrity_incidents")
    .select("id", { count: "exact", head: true })
    .eq("original_driver_id", assignment.driverId);

  const { data: lastGps } = await supabase
    .from("driver_integrity_gps_samples")
    .select("lat,lng,captured_at")
    .eq("entity_type", assignment.entityType)
    .eq("entity_id", assignment.entityId)
    .eq("driver_id", assignment.driverId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousGps = lastGps
    ? asCoord(lastGps.lat, lastGps.lng, lastGps.captured_at)
    : null;

  const plan = planIntegrityScan({
    settings,
    signals,
    assignment: liveAssignment,
    history: {
      firstWarningAtMs: asIsoMs(first?.sent_at),
      finalWarningAtMs: asIsoMs(final?.sent_at),
      reassignedAtMs: asIsoMs(incident?.reassigned_at),
      reviewOpenedAtMs: asIsoMs(incident?.review_opened_at),
    },
    acceptGps,
    currentGps,
    previousGps,
    priorAnomalyCount: priorCount ?? 0,
  });

  if (plan.kind === "skip") return;

  const warning = decideWarningAction({
    settings,
    signals,
    history: {
      firstWarningAtMs: asIsoMs(first?.sent_at),
      finalWarningAtMs: asIsoMs(final?.sent_at),
      reassignedAtMs: asIsoMs(incident?.reassigned_at),
      reviewOpenedAtMs: asIsoMs(incident?.review_opened_at),
    },
  });

  const anomalies = detectAnomalies({
    signals,
    settings,
    acceptGps,
    currentGps,
    previousGps,
    priorAnomalyCount: priorCount ?? 0,
  });

  const highest = anomalies.some((a) => a.severity === "high")
    ? "high"
    : anomalies.some((a) => a.severity === "medium")
      ? "medium"
      : anomalies.length
        ? "low"
        : "info";

  if (currentGps) {
    await supabase.from("driver_integrity_gps_samples").insert({
      entity_type: assignment.entityType,
      entity_id: assignment.entityId,
      driver_id: assignment.driverId,
      lat: currentGps.lat,
      lng: currentGps.lng,
      captured_at: new Date(currentGps.atMs).toISOString(),
    });
  }

  if (
    warning.action === "none" &&
    anomalies.length === 0 &&
    !incident?.id
  ) {
    return;
  }

  // Never mark reassigned until the RPC commits. Eligibility/RPC failure
  // must leave the incident in its prior warning/review state.
  const nextStatus =
    warning.action === "reassign"
      ? incident?.status ?? "final_warning"
      : warning.action === "open_review"
        ? "review"
        : warning.action === "final_warning"
          ? "final_warning"
          : warning.action === "first_warning"
            ? "warning"
            : incident?.status ?? "open";

  const upserted = await upsertIncident(supabase, {
    entity_type: assignment.entityType,
    entity_id: assignment.entityId,
    original_driver_id: assignment.driverId,
    original_driver_accepted_at: assignment.driverAcceptedAt,
    status: nextStatus,
    last_case: plan.kind === "act" ? warning.reason : "open",
    last_anomalies: anomalies.map((a) => a.type),
    severity: highest,
    accept_lat: acceptGps?.lat ?? currentGps?.lat ?? null,
    accept_lng: acceptGps?.lng ?? currentGps?.lng ?? null,
    evidence: {
      gps_available: gpsAvailable,
      gps_stale: gpsStale,
      meters_from_accept: metersFromAccept,
      wait_reason: waitReason,
      anomalies,
    },
    review_opened_at:
      warning.action === "open_review"
        ? new Date().toISOString()
        : incident?.review_opened_at ?? null,
  });
  if (!upserted) return;
  counters.incidentsUpserted += upserted.duplicate ? 0 : 1;
  if (upserted.duplicate) counters.duplicates += 1;

  if (warning.action === "first_warning" || warning.action === "final_warning") {
    const kind = warning.action === "final_warning" ? "final" : "first";
    const inserted = await insertWarningIdempotent(supabase, upserted.id, kind);
    if (inserted) {
      const notified = await notifyDriverIntegrityWarning({
        supabaseAdmin: supabase,
        driverUserId: assignment.driverId,
        incidentId: upserted.id,
        entityType: assignment.entityType,
        entityId: assignment.entityId,
        kind,
      });
      if (notified.duplicate) counters.duplicates += 1;
      if (kind === "first") counters.warnings += 1;
      else counters.finalWarnings += 1;
      await recordEvent(supabase, upserted.id, `DRIVER_${kind.toUpperCase()}_WARNING`, {
        kind,
        reason: warning.reason,
      });
    } else {
      counters.duplicates += 1;
    }
  }

  if (warning.action === "open_review") {
    counters.reviewsOpened += 1;
    await recordEvent(supabase, upserted.id, "DRIVER_INTEGRITY_REVIEW_OPENED", {
      reason: warning.reason,
    });
  }

  if (warning.action === "reassign") {
    const eligibility = evaluateReassignmentEligibility({
      settings,
      signals,
      assignment: liveAssignment,
      expectedDriverId: assignment.driverId,
      firstWarningAtMs: asIsoMs(first?.sent_at),
    });
    if (eligibility.ok === false) return;
    const rpc =
      assignment.entityType === "order"
        ? "driver_integrity_reassign_order"
        : assignment.entityType === "marketplace_job"
          ? "driver_integrity_reassign_marketplace_job"
          : "driver_integrity_reassign_delivery_request";
    const args =
      assignment.entityType === "order"
        ? {
            p_order_id: assignment.entityId,
            p_expected_driver_id: assignment.driverId,
            p_incident_id: upserted.id,
          }
        : assignment.entityType === "marketplace_job"
          ? {
              p_job_id: assignment.entityId,
              p_expected_driver_id: assignment.driverId,
              p_incident_id: upserted.id,
            }
          : {
              p_request_id: assignment.entityId,
              p_expected_driver_id: assignment.driverId,
              p_incident_id: upserted.id,
            };
    const { data, error } = await supabase.rpc(rpc, args);
    const payload = data as Record<string, unknown> | null;
    if (error || payload?.ok !== true) {
      await recordEvent(supabase, upserted.id, "DRIVER_ORDER_REASSIGN_BLOCKED", {
        error: error?.message ?? payload?.message ?? "blocked",
      });
      return;
    }
    if (payload?.idempotent === true) {
      counters.duplicates += 1;
      return;
    }
    counters.reassigned += 1;
    await maybeRedispatch(
      origin,
      assignment.entityType,
      assignment.entityId,
      assignment.driverId
    );
  }
}

function keysetFilter(cursor: ScanCursor): string | null {
  if (!cursor.lastAcceptedAt || !cursor.lastId) return null;
  return `driver_accepted_at.gt.${cursor.lastAcceptedAt},and(driver_accepted_at.eq.${cursor.lastAcceptedAt},id.gt.${cursor.lastId})`;
}

async function fetchScanPage(
  supabase: SupabaseClient,
  entityType: DriverIntegrityEntityType,
  cursor: ScanCursor,
  engineStartAt: string
): Promise<Array<Record<string, unknown>>> {
  const filter = keysetFilter(cursor);
  const run = async (withCursor: boolean) => {
    if (entityType === "marketplace_job") {
      let q = supabase
        .from("marketplace_delivery_jobs")
        .select("id,status,assigned_driver_id,driver_accepted_at")
        .not("assigned_driver_id", "is", null)
        .not("driver_accepted_at", "is", null)
        .gte("driver_accepted_at", engineStartAt)
        .eq("status", "dispatch_assigned")
        .order("driver_accepted_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(DRIVER_INTEGRITY_SCAN_PAGE_SIZE);
      if (withCursor && filter) q = q.or(filter);
      return q;
    }
    if (entityType === "order") {
      let q = supabase
        .from("orders")
        .select(
          "id,status,driver_id,driver_accepted_at,picked_up_at,delivered_at,cancelled_at"
        )
        .eq("is_test", false)
        .is("archived_at", null)
        .not("driver_id", "is", null)
        .not("driver_accepted_at", "is", null)
        .gte("driver_accepted_at", engineStartAt)
        .is("picked_up_at", null)
        .is("delivered_at", null)
        .is("cancelled_at", null)
        .eq("status", "dispatched")
        .order("driver_accepted_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(DRIVER_INTEGRITY_SCAN_PAGE_SIZE);
      if (withCursor && filter) q = q.or(filter);
      return q;
    }
    let q = supabase
      .from("delivery_requests")
      .select(
        "id,status,driver_id,driver_accepted_at,picked_up_at,delivered_at,cancelled_at"
      )
      .eq("is_test", false)
      .is("archived_at", null)
      .not("driver_id", "is", null)
      .not("driver_accepted_at", "is", null)
      .gte("driver_accepted_at", engineStartAt)
      .is("picked_up_at", null)
      .is("delivered_at", null)
      .is("cancelled_at", null)
      .eq("status", "dispatched")
      .order("driver_accepted_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(DRIVER_INTEGRITY_SCAN_PAGE_SIZE);
    if (withCursor && filter) q = q.or(filter);
    return q;
  };

  const first = await run(true);
  if ((first.data ?? []).length > 0) return first.data as Array<Record<string, unknown>>;
  if (!filter) return [];
  const wrapped = await run(false);
  return (wrapped.data ?? []) as Array<Record<string, unknown>>;
}

function emptyCounters(skipReason: string | null, skipped: boolean): ScanCounters {
  return {
    skipped,
    skipReason,
    scanned: 0,
    warnings: 0,
    finalWarnings: 0,
    reassigned: 0,
    reviewsOpened: 0,
    incidentsUpserted: 0,
    duplicates: 0,
    truncated: false,
  };
}

async function scanPagedAssignments(
  supabase: SupabaseClient,
  settings: DriverIntegritySettings,
  entityType: DriverIntegrityEntityType,
  rows: Array<{
    id: unknown;
    status: unknown;
    driverId: unknown;
    driverAcceptedAt: unknown;
    pickedUpAt?: unknown;
    deliveredAt?: unknown;
    cancelledAt?: unknown;
  }>,
  nowMs: number,
  origin: string | null,
  counters: ScanCounters,
  startedMs: number,
  budgetMs: number
): Promise<ScanCursor | null> {
  let last: ScanCursor | null = null;
  for (const row of rows) {
    if (isDeadlineApproaching(startedMs, budgetMs)) {
      counters.truncated = true;
      break;
    }
    const acceptedAt = row.driverAcceptedAt ? String(row.driverAcceptedAt) : "";
    const id = String(row.id);
    await scanEntity(
      supabase,
      settings,
      {
        entityType,
        entityId: id,
        driverId: String(row.driverId),
        status: String(row.status),
        driverAcceptedAt: acceptedAt || null,
        pickedUpAt: row.pickedUpAt ? String(row.pickedUpAt) : null,
        deliveredAt: row.deliveredAt ? String(row.deliveredAt) : null,
        cancelledAt: row.cancelledAt ? String(row.cancelledAt) : null,
        alreadyReassigned: false,
      },
      nowMs,
      origin,
      counters
    );
    last = { lastAcceptedAt: acceptedAt || null, lastId: id };
  }
  return last;
}

export async function runDriverIntegrityScan(
  supabase: SupabaseClient,
  opts?: { origin?: string | null; nowMs?: number; startedMs?: number; budgetMs?: number }
): Promise<ScanCounters> {
  const settings = await loadDriverIntegritySettings(supabase);
  const skip = failClosedScanSkipReason(settings);
  if (skip) return emptyCounters(skip, true);

  const lock = await acquireCronJobLock(supabase, "driver_integrity_scan", {
    ttlSeconds: DRIVER_INTEGRITY_LOCK_TTL_SECONDS,
  });
  if (lock.ok === false) return emptyCounters("lock_busy", true);

  const lockedBy = lock.lockedBy;
  const counters = emptyCounters(null, false);
  const nowMs = opts?.nowMs ?? Date.now();
  const origin = opts?.origin ?? null;
  const startedMs = opts?.startedMs ?? Date.now();
  const budgetMs = opts?.budgetMs ?? CRON_JOB_BUDGET_MS;

  try {
    for (const entityType of [
      "order",
      "delivery_request",
      "marketplace_job",
    ] as const) {
      if (isDeadlineApproaching(startedMs, budgetMs)) {
        counters.truncated = true;
        break;
      }
      const cursor = await loadScanCursor(supabase, entityType);
      const rows = await fetchScanPage(
        supabase,
        entityType,
        cursor,
        String(settings.engineStartAt)
      );
      const mapped = rows.map((row) => ({
        id: row.id,
        status: row.status,
        driverId:
          entityType === "marketplace_job"
            ? row.assigned_driver_id
            : row.driver_id,
        driverAcceptedAt: row.driver_accepted_at,
        pickedUpAt: row.picked_up_at,
        deliveredAt: row.delivered_at,
        cancelledAt: row.cancelled_at,
      }));

      const last = await scanPagedAssignments(
        supabase,
        settings,
        entityType,
        mapped,
        nowMs,
        origin,
        counters,
        startedMs,
        budgetMs
      );
      if (last) await saveScanCursor(supabase, entityType, last);
    }
  } finally {
    await releaseCronJobLock(supabase, "driver_integrity_scan", lockedBy);
  }

  return counters;
}
