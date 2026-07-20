import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 200);
    const status = params.get("status")?.trim();
    const vehicleClass = params.get("vehicle_class")?.trim();
    const paymentStatus = params.get("payment_status")?.trim();
    const q = params.get("q")?.trim();

    let query = supabase
      .from("taxi_rides")
      .select(
        `id, status, vehicle_class, payment_status, refund_status,
         total_cents, currency, client_user_id, driver_id,
         pickup_address, dropoff_address, created_at, completed_at`
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (vehicleClass) query = query.eq("vehicle_class", vehicleClass);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (q) {
      const safeQ = q.replace(/[%_,]/g, "");
      if (/^[0-9a-f-]{8,}$/i.test(safeQ)) {
        query = query.or(
          `id.eq.${safeQ},pickup_address.ilike.%${safeQ}%,dropoff_address.ilike.%${safeQ}%`
        );
      } else {
        query = query.or(
          `pickup_address.ilike.%${safeQ}%,dropoff_address.ilike.%${safeQ}%`
        );
      }
    }

    const { data, error } = await applyLiveTripFilters(query);

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
