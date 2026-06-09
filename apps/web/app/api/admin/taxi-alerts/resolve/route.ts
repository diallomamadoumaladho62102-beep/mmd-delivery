import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiAlerts,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { logTaxiEventServer } from "@/lib/taxiEvents";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiAlerts(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const alertId = String(body.alert_id ?? body.alertId ?? "").trim();
    const alertTable = String(body.alert_table ?? body.alertTable ?? "").trim();
    const taxiRideId = String(body.taxi_ride_id ?? body.taxiRideId ?? "").trim();

    if (!alertId || !alertTable) {
      return json({ ok: false, error: "Missing alert_id or alert_table" }, 400);
    }

    const { data, error } = await supabase.rpc("resolve_taxi_alert", {
      p_alert_table: alertTable,
      p_alert_id: alertId,
      p_resolved_by: session.userId,
    });

    if (error) return json({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return json({ ok: false, ...result }, 404);
    }

    if (taxiRideId) {
      await logTaxiEventServer(supabase, {
        rideId: taxiRideId,
        eventType: "alert_resolved",
        triggeredRole: "admin",
        actorId: session.userId,
        description: `Admin resolved ${alertTable} alert`,
        metadata: { alert_id: alertId, alert_table: alertTable },
      });
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_alert_resolved",
      targetType: `taxi_${alertTable}_alert`,
      targetId: alertId,
      newValues: { status: "resolved", alert_table: alertTable },
      request,
    });

    return json({ ok: true, result });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
