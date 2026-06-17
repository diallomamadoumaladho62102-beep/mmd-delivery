import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const REGION_SELECT =
  "id, country_code, region_code, region_name, region_type, mmd_zone_id, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, marketplace_checkout_live_enabled, marketplace_dispatch_live_enabled, marketplace_payouts_live_enabled, maintenance_mode, launch_status, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("platform_launch.read", request);
    const supabase = buildSupabaseAdminClient();
    const country = String(new URL(request.url).searchParams.get("country") ?? "")
      .trim()
      .toUpperCase();

    let query = supabase
      .from("platform_regions")
      .select(REGION_SELECT)
      .order("country_code", { ascending: true })
      .order("region_name", { ascending: true });

    if (country) {
      query = query.eq("country_code", country);
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
