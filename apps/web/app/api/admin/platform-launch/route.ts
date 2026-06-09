import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "id, country_code, country_name, continent, region, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("platform_launch.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("platform_countries")
      .select(SELECT)
      .order("continent", { ascending: true, nullsFirst: false })
      .order("country_name", { ascending: true });

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

export async function POST() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}
