import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/** List frozen commission snapshots with filters. Snapshots are never mutated. */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const orderKind = String(params.get("orderKind") ?? "").trim();
    const partnerType = String(params.get("partnerType") ?? "").trim();
    const partnerUserId = String(params.get("partnerUserId") ?? "").trim();
    const ruleType = String(params.get("ruleType") ?? "").trim();
    const country = String(params.get("countryCode") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("commission_snapshots")
      .select("*")
      .order("resolved_at", { ascending: false })
      .limit(limit);
    if (orderKind) query = query.eq("order_kind", orderKind);
    if (partnerType) query = query.eq("partner_type", partnerType);
    if (partnerUserId) query = query.eq("partner_user_id", partnerUserId);
    if (ruleType) query = query.eq("rule_type", ruleType);
    if (country) query = query.eq("country_code", country.toUpperCase());

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, snapshots: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
