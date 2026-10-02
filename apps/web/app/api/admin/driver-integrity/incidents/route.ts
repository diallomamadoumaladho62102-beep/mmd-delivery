import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("driver_integrity.read", request);
    const supabase = buildSupabaseAdminClient();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const driverId = url.searchParams.get("driver_id");
    const entityId = url.searchParams.get("entity_id");
    const severity = url.searchParams.get("severity");
    const anomalyType = url.searchParams.get("anomaly_type");

    let query = supabase
      .from("driver_integrity_incidents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) query = query.eq("status", status);
    if (driverId) query = query.eq("original_driver_id", driverId);
    if (entityId) query = query.eq("entity_id", entityId);
    if (severity) query = query.eq("severity", severity);
    if (anomalyType) query = query.contains("last_anomalies", [anomalyType]);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: "incidents_load_failed" }, 500);

    const ids = (data ?? []).map((row) => String(row.id));
    const entityIds = (data ?? []).map((row) => String(row.entity_id));
    const { data: warnings } = ids.length
      ? await supabase
          .from("driver_integrity_warnings")
          .select("*")
          .in("incident_id", ids)
      : { data: [] as Array<Record<string, unknown>> };

    const { data: waitReasons } = entityIds.length
      ? await supabase
          .from("driver_wait_reasons")
          .select("id,entity_type,entity_id,driver_id,reason_code,created_at,incident_id")
          .in("entity_id", entityIds)
          .order("created_at", { ascending: false })
          .limit(400)
      : { data: [] as Array<Record<string, unknown>> };

    const { data: assignmentHistory } = entityIds.length
      ? await supabase
          .from("trip_time_intervals")
          .select(
            "id,entity_type,entity_id,driver_id,assignment_seq,started_at,ended_at,end_reason"
          )
          .in("entity_id", entityIds)
          .order("assignment_seq", { ascending: true })
          .limit(400)
      : { data: [] as Array<Record<string, unknown>> };

    return json({
      ok: true,
      incidents: data ?? [],
      warnings: warnings ?? [],
      wait_reasons: waitReasons ?? [],
      assignment_history: assignmentHistory ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
