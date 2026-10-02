import { NextRequest, NextResponse } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { parseWaitReasonCode } from "@/lib/driverIntegrity/waitReasons";
import { DRIVER_INTEGRITY_ENTITY_TYPES } from "@/lib/driverIntegrity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entityType = String(body.entity_type ?? "").trim();
  const entityId = String(body.entity_id ?? "").trim();
  const reason = parseWaitReasonCode(body.reason_code);
  const explanation = String(body.explanation ?? "").trim() || null;

  if (!(DRIVER_INTEGRITY_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return json({ ok: false, error: "invalid_entity" }, 400);
  }
  if (!entityId) return json({ ok: false, error: "entity_required" }, 400);
  if (!reason) return json({ ok: false, error: "invalid_reason" }, 400);

  const table = entityType === "order" ? "orders" : "delivery_requests";
  const { data: assigned } = await auth.supabaseAdmin
    .from(table)
    .select("id,driver_id,driver_accepted_at")
    .eq("id", entityId)
    .maybeSingle();
  if (!assigned) return json({ ok: false, error: "not_found" }, 404);

  const { data: incident } = await auth.supabaseAdmin
    .from("driver_integrity_incidents")
    .select("id,original_driver_id,original_driver_accepted_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("original_driver_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    String(assigned.driver_id ?? "") !== auth.userId &&
    String(incident?.original_driver_id ?? "") !== auth.userId
  ) {
    return json({ ok: false, error: "forbidden" }, 403);
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
        incident?.original_driver_accepted_at ?? assigned.driver_accepted_at ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) return json({ ok: false, error: "save_failed" }, 500);

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
