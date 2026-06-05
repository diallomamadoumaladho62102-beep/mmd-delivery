import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanReadPricing } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertCanReadPricing(request);
    const supabase = buildSupabaseAdminClient();
    const configId = String(request.nextUrl.searchParams.get("configId") ?? "").trim();
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 50), 1), 100);

    let query = supabase
      .from("pricing_config_history")
      .select(
        "id, pricing_config_id, changed_by, change_type, old_values, new_values, ip_address, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (configId) query = query.eq("pricing_config_id", configId);

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
