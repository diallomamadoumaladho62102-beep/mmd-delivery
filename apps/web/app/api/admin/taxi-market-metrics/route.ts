import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_market_metrics.read", request);
    const supabase = buildSupabaseAdminClient();
    const countryCode = String(
      request.nextUrl.searchParams.get("country_code") ?? ""
    )
      .trim()
      .toUpperCase();

    let query = supabase
      .from("taxi_market_metrics")
      .select("*")
      .order("snapshot_at", { ascending: false })
      .limit(countryCode ? 10 : 100);

    if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    const { data, error } = await query;
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
