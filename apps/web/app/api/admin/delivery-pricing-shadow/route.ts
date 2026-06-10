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
    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1),
      200
    );
    const sourceType = request.nextUrl.searchParams.get("source_type");

    let query = supabase
      .from("delivery_pricing_shadow_logs")
      .select(
        "id, source_type, source_id, country_code, region_code, zone_code, old_customer_total_cents, old_driver_earning_cents, v2_customer_total_cents, v2_driver_earning_cents, v2_platform_margin_cents, diff_customer_cents, diff_driver_cents, diff_margin_cents, pricing_engine_version, inputs, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (sourceType) {
      query = query.eq("source_type", sourceType);
    }

    const { data, error } = await query;

    if (error) {
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
