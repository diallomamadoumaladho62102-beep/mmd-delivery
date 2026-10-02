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
    const driverId = url.searchParams.get("driver_id");
    let query = supabase
      .from("driver_trip_disputes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (driverId) query = query.eq("driver_id", driverId);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: "disputes_load_failed" }, 500);
    return json({ ok: true, disputes: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
