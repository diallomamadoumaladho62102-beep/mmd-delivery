import { NextRequest, NextResponse } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import {
  driverOwnsAssignment,
  isUniqueViolation,
  loadAssignedEntity,
} from "@/lib/driverIntegrity/assignmentOwnership";
import {
  DRIVER_DISPUTE_REASON_CODES,
  parseDisputeReasonCode,
} from "@/lib/driverIntegrity/disputeReasons";
import {
  DRIVER_INTEGRITY_ENTITY_TYPES,
  type DriverIntegrityEntityType,
} from "@/lib/driverIntegrity/types";

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
    reasons: [...DRIVER_DISPUTE_REASON_CODES],
    timestamps_unchanged: true,
    earnings_unchanged: true,
  };

  if (!entityType || !entityId) {
    return json(catalog);
  }

  const assigned = await loadAssignedEntity(auth.supabaseAdmin, entityType, entityId);
  const { data: incident } = await auth.supabaseAdmin
    .from("driver_integrity_incidents")
    .select("id,original_driver_id,status")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("original_driver_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const owns =
    (assigned && driverOwnsAssignment(assigned, auth.userId)) ||
    String(incident?.original_driver_id ?? "") === auth.userId;
  if (!owns) {
    return json({ ...catalog, current: null, unauthorized: true }, 403);
  }

  const { data: current } = await auth.supabaseAdmin
    .from("driver_trip_disputes")
    .select("id,reason_code,explanation,created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("driver_id", auth.userId)
    .maybeSingle();

  return json({
    ...catalog,
    current: current ?? null,
    incident_status: incident?.status ?? null,
    incident_closed: incident?.status === "closed" || incident?.status === "policy_action",
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entityType = parseEntityType(body.entity_type);
  const entityId = String(body.entity_id ?? "").trim();
  const reason = parseDisputeReasonCode(body.reason_code);
  const explanation = String(body.explanation ?? "").trim() || null;

  if (!entityType) return json({ ok: false, error: "invalid_entity" }, 400);
  if (!entityId) return json({ ok: false, error: "entity_required" }, 400);
  if (!reason) return json({ ok: false, error: "invalid_reason" }, 400);

  const assigned = await loadAssignedEntity(auth.supabaseAdmin, entityType, entityId);
  if (!assigned) return json({ ok: false, error: "not_found" }, 404);

  const { data: incident } = await auth.supabaseAdmin
    .from("driver_integrity_incidents")
    .select("id,original_driver_id,original_driver_accepted_at,status")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("original_driver_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    !driverOwnsAssignment(assigned, auth.userId) &&
    String(incident?.original_driver_id ?? "") !== auth.userId
  ) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  if (incident?.status === "closed" || incident?.status === "policy_action") {
    return json({ ok: false, error: "incident_closed" }, 409);
  }

  const { data, error } = await auth.supabaseAdmin
    .from("driver_trip_disputes")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      driver_id: auth.userId,
      incident_id: incident?.id ?? null,
      reason_code: reason,
      explanation,
      original_driver_accepted_at:
        incident?.original_driver_accepted_at ?? assigned.driverAcceptedAt ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: existing } = await auth.supabaseAdmin
        .from("driver_trip_disputes")
        .select("id")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("driver_id", auth.userId)
        .maybeSingle();
      return json({
        ok: true,
        already_submitted: true,
        id: existing?.id ?? null,
        timestamps_unchanged: true,
        earnings_unchanged: true,
      });
    }
    return json({ ok: false, error: "save_failed" }, 500);
  }

  if (incident?.id) {
    await auth.supabaseAdmin.from("driver_integrity_events").insert({
      incident_id: incident.id,
      event_type: "DRIVER_TRIP_DISPUTE",
      payload: { reason_code: reason, dispute_id: data?.id ?? null },
    });
  }

  return json({
    ok: true,
    id: data?.id ?? null,
    timestamps_unchanged: true,
    earnings_unchanged: true,
  });
}
