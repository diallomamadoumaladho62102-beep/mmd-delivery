import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const COUNTY_SELECT =
  "id, country_code, region_code, county_code, county_name, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("platform_launch.read", request);
    const supabase = buildSupabaseAdminClient();
    const url = new URL(request.url);
    const country = String(url.searchParams.get("country") ?? "")
      .trim()
      .toUpperCase();
    const region = String(url.searchParams.get("region") ?? "")
      .trim()
      .toLowerCase();

    let query = supabase
      .from("platform_counties")
      .select(COUNTY_SELECT)
      .order("country_code", { ascending: true })
      .order("region_code", { ascending: true })
      .order("county_name", { ascending: true });

    if (country) {
      query = query.eq("country_code", country);
    }
    if (region) {
      query = query.eq("region_code", region);
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
