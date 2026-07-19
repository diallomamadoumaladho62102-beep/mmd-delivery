import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("subscriptions.read", request);
    const supabase = buildSupabaseAdminClient();
    const partnerUserId = String(request.nextUrl.searchParams.get("partnerUserId") ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 100) || 100));

    let invoicesQ = supabase
      .from("subscription_invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (partnerUserId) invoicesQ = invoicesQ.eq("partner_user_id", partnerUserId);

    let auditQ = supabase
      .from("subscription_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (partnerUserId) auditQ = auditQ.eq("partner_user_id", partnerUserId);

    const [invoices, audit] = await Promise.all([invoicesQ, auditQ]);
    if (invoices.error) return json({ ok: false, error: invoices.error.message }, 500);

    return json({
      ok: true,
      invoices: invoices.data ?? [],
      audit: audit.data ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
