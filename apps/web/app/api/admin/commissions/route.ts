import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 50), 1), 200);

    const { data, error } = await supabase
      .from("order_commissions")
      .select(
        "order_id, platform_pct, platform_amount, driver_pct, driver_amount, restaurant_pct, restaurant_amount, currency, updated_at, orders:orders(order_type)"
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

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
