import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_shared_rides.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_shared_rides")
      .select(
        `
        *,
        taxi_shared_ride_passengers (
          id,
          client_user_id,
          segment_order,
          pickup_address,
          dropoff_address,
          share_discount_cents,
          status,
          taxi_ride_id
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(100);

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

export async function POST() {
  return json({ error: "Method not allowed" }, 405);
}
