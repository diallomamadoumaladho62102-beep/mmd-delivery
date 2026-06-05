import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("supervision.read", request);
    const supabase = buildSupabaseAdminClient();

    const [
      pendingOrders,
      activeDrivers,
      unpaidOrders,
      failedPayouts,
      pendingDispatch,
      recentWebhooks,
    ] = await Promise.all([
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "accepted", "prepared", "ready"]),
      supabase
        .from("driver_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("is_online", true),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .neq("payment_status", "paid"),
      supabase
        .from("order_payouts")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase
        .from("order_dispatch_wave_schedule")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("stripe_webhook_events")
        .select("id", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);

    return json({
      ok: true,
      metrics: {
        pending_orders: pendingOrders.count ?? 0,
        online_drivers: activeDrivers.count ?? 0,
        unpaid_orders: unpaidOrders.count ?? 0,
        failed_payouts: failedPayouts.count ?? 0,
        pending_dispatch_retries: pendingDispatch.count ?? 0,
        webhooks_24h: recentWebhooks.count ?? 0,
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
