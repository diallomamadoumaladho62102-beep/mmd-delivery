import { NextRequest, NextResponse } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import {
  driverOwnsAssignment,
  isUniqueViolation,
  loadAssignedEntity,
} from "@/lib/driverIntegrity/assignmentOwnership";
import {
  DRIVER_INTEGRITY_ENTITY_TYPES,
  DRIVER_WAIT_REASON_CODES,
  type DriverIntegrityEntityType,
} from "@/lib/driverIntegrity/types";
import { parseWaitReasonCode } from "@/lib/driverIntegrity/waitReasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function parseEntityType(value: unknown): DriverIntegrityEntityType | null {
  const raw = String(value ?? "").trim();
  if ((DRIVER_INTEGRITY_ENTITY_TYPES as readonly string[]).includes(raw)) {
    return raw as DriverIntegrityEntityType;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const entityType = parseEntityType(url.searchParams.get("entity_type"));
  const entityId = String(url.searchParams.get("entity_id") ?? "").trim();

  const catalog = {
    ok: true,
    reasons: [...DRIVER_WAIT_REASON_CODES],
    timestamps_unchanged: true,
  };

  if (!entityType || !entityId) {
    return json(catalog);
  }

  const assigned = await loadAssignedEntity(auth.supabaseAdmin, entityType, entityId);
  if (!assigned || !driverOwnsAssignment(assigned, auth.userId)) {
    return json({ ...catalog, current: null, unauthorized: true }, 403);
  }

  const { data: current } = await auth.supabaseAdmin
    .from("driver_wait_reasons")
    .select("id,reason_code,explanation,created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("driver_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return json({
    ...catalog,
    current: current ?? null,
    driver_accepted_at: assigned.driverAcceptedAt,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entityType = parseEntityType(body.entity_type);
  const entityId = String(body.entity_id ?? "").trim();
  const reason = parseWaitReasonCode(body.reason_code);
  const explanation = String(body.explanation ?? "").trim() || null;

  if (!entityType) return json({ ok: false, error: "invalid_entity" }, 400);
  if (!entityId) return json({ ok: false, error: "entity_required" }, 400);
  if (!reason) return json({ ok: false, error: "invalid_reason" }, 400);

  const assigned = await loadAssignedEntity(auth.supabaseAdmin, entityType, entityId);
  if (!assigned || !driverOwnsAssignment(assigned, auth.userId)) {
    return json({ ok: false, error: "not_assigned" }, 403);
  }

  const { data: incident } = await auth.supabaseAdmin
    .from("driver_integrity_incidents")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("original_driver_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await auth.supabaseAdmin
    .from("driver_wait_reasons")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      driver_id: auth.userId,
      incident_id: incident?.id ?? null,
      reason_code: reason,
      explanation,
    })
    .select("id,created_at")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await auth.supabaseAdmin
        .from("driver_wait_reasons")
        .select("id,created_at")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("driver_id", auth.userId)
        .eq("reason_code", reason)
        .maybeSingle();
      return json({
        ok: true,
        already_submitted: true,
        id: existing?.id ?? null,
        timestamps_unchanged: true,
        driver_accepted_at: assigned.driverAcceptedAt,
      });
    }
    return json({ ok: false, error: "save_failed" }, 500);
  }

  if (incident?.id) {
    await auth.supabaseAdmin.from("driver_integrity_events").insert({
      incident_id: incident.id,
      event_type: "DRIVER_WAIT_REASON",
      payload: { reason_code: reason },
    });
  }

  return json({
    ok: true,
    id: data?.id ?? null,
    timestamps_unchanged: true,
    driver_accepted_at: assigned.driverAcceptedAt,
  });
}
