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
    await assertStaffPermission("orders.read", request);
    const supabase = buildSupabaseAdminClient();
    const { searchParams } = request.nextUrl;

    const status = String(searchParams.get("status") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 200);

    let query = supabase
      .from("orders")
      .select(
        "id, status, kind, payment_status, subtotal, total, currency, restaurant_name, driver_id, created_at, paid_at, delivered_confirmed_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    query = applyLiveTripFilters(query);

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
