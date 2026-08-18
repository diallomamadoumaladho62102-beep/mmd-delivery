import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageOrders,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  isAbandonedStaleAssignedJob,
  staleJobAgeHours,
  suggestedAdminActionForStaleJob,
  STALE_ASSIGNED_JOB_AGE_MS,
} from "@/lib/adminStaleDriverJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ops/stale-driver-jobs
 * Lists abandoned assigned Food/Delivery jobs for Admin review.
 * READ-ONLY — does not mutate statuses.
 */
export async function GET(req: NextRequest) {
  try {
    await assertCanManageOrders(req);
    const admin = buildSupabaseAdminClient();
    const nowMs = Date.now();
    const lookbackIso = new Date(nowMs - 60 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: orders, error: ordersErr }, { data: deliveries, error: delErr }] =
      await Promise.all([
        admin
          .from("orders")
          .select(
            "id, kind, status, driver_id, driver_delivery_payout, restaurant_name, created_at, updated_at, payment_status",
          )
          .not("driver_id", "is", null)
          .gte("updated_at", lookbackIso)
          .order("updated_at", { ascending: true })
          .limit(200),
        admin
          .from("delivery_requests")
          .select(
            "id, status, driver_id, driver_delivery_payout, created_at, updated_at, payment_status",
          )
          .not("driver_id", "is", null)
          .gte("updated_at", lookbackIso)
          .order("updated_at", { ascending: true })
          .limit(200),
      ]);

    if (ordersErr) {
      return NextResponse.json({ ok: false, error: ordersErr.message }, { status: 500 });
    }
    if (delErr) {
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    const staleOrders = (orders ?? [])
      .filter((row) => isAbandonedStaleAssignedJob(row, nowMs))
      .map((row) => ({
        id: row.id,
        service: String(row.kind ?? "food").toLowerCase().includes("food")
          ? "food"
          : "order",
        status: row.status,
        driver_id: row.driver_id,
        payment_status: row.payment_status,
        driver_delivery_payout: row.driver_delivery_payout,
        restaurant_name: row.restaurant_name ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        age_hours: staleJobAgeHours(row, nowMs),
        suggested_action: suggestedAdminActionForStaleJob(row.status),
        source_table: "orders",
      }));

    const staleDeliveries = (deliveries ?? [])
      .filter((row) => isAbandonedStaleAssignedJob(row, nowMs))
      .map((row) => ({
        id: row.id,
        service: "delivery",
        status: row.status,
        driver_id: row.driver_id,
        payment_status: row.payment_status,
        driver_delivery_payout: row.driver_delivery_payout,
        restaurant_name: null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        age_hours: staleJobAgeHours(row, nowMs),
        suggested_action: suggestedAdminActionForStaleJob(row.status),
        source_table: "delivery_requests",
      }));

    const items = [...staleOrders, ...staleDeliveries].sort(
      (a, b) => Number(b.age_hours ?? 0) - Number(a.age_hours ?? 0),
    );

    return NextResponse.json({
      ok: true,
      stale_after_ms: STALE_ASSIGNED_JOB_AGE_MS,
      count: items.length,
      items,
      note: "READ-ONLY inventory. Use audited Admin cancel/force-complete — do not silently mutate.",
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 },
    );
  }
}
