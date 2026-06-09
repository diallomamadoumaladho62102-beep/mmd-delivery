import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_monitoring.read", request);
    const supabase = buildSupabaseAdminClient();

    const [
      healthRes,
      dispatchRes,
      paymentRes,
      marketRes,
      dispatchAlertsRes,
      paymentAlertsRes,
      payoutAlertsRes,
    ] = await Promise.all([
      supabase
        .from("taxi_system_health")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("taxi_dispatch_metrics")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("taxi_payment_metrics")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("taxi_market_metrics")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(50),
      supabase
        .from("taxi_dispatch_alerts")
        .select("id, taxi_ride_id, alert_type, status, detected_at, metadata")
        .eq("status", "open")
        .order("detected_at", { ascending: false })
        .limit(50),
      supabase
        .from("taxi_payment_alerts")
        .select("id, taxi_ride_id, alert_type, status, detected_at, metadata")
        .eq("status", "open")
        .order("detected_at", { ascending: false })
        .limit(50),
      supabase
        .from("taxi_payout_alerts")
        .select("id, taxi_ride_id, alert_type, status, detected_at, metadata")
        .eq("status", "open")
        .order("detected_at", { ascending: false })
        .limit(50),
    ]);

    const latestSnapshotAt = healthRes.data?.snapshot_at ?? null;
    const marketRows = (marketRes.data ?? []).filter(
      (row) => !latestSnapshotAt || row.snapshot_at === latestSnapshotAt
    );

    return json({
      ok: true,
      system_health: healthRes.data ?? null,
      dispatch_metrics: dispatchRes.data ?? null,
      payment_metrics: paymentRes.data ?? null,
      market_metrics: marketRows,
      open_alerts: {
        dispatch: dispatchAlertsRes.data ?? [],
        payment: paymentAlertsRes.data ?? [],
        payout: payoutAlertsRes.data ?? [],
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
