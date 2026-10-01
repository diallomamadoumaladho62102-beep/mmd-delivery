import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
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
      .from("minimum_pay_adjustments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ ok: false, error: "adjustments_load_failed" }, 500);
    return json({ ok: true, adjustments: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
