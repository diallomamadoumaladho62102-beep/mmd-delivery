import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_plus.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const userId = String(params.get("userId") ?? "").trim();
    const subscriptionId = String(params.get("subscriptionId") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("mmd_plus_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (userId) query = query.eq("user_id", userId);
    if (subscriptionId) query = query.eq("subscription_id", subscriptionId);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: audit } = await supabase
      .from("mmd_plus_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    return json({ ok: true, invoices: data ?? [], audit: audit ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
