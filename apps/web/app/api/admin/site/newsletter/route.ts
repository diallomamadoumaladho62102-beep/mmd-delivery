import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { adminError, cleanText, json } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const status = cleanText(params.get("status"), 40);
    const limit = Math.min(
      500,
      Math.max(1, Number(params.get("limit") ?? 200) || 200),
    );

    let query = supabase
      .from("site_newsletter_subscribers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, subscribers: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}
