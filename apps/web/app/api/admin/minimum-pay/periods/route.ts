import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { closeDueMinimumPayPeriods } from "@/lib/minimumPay/closePayPeriod";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("minimum_pay.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("pay_periods")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(50);
    if (error) return json({ ok: false, error: "periods_load_failed" }, 500);
    return json({ ok: true, periods: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("minimum_pay.manage", request);
    const supabase = buildSupabaseAdminClient();
    const result = await closeDueMinimumPayPeriods(supabase, `admin:${session.userId}`);
    return json(result, result.ok ? 200 : 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
