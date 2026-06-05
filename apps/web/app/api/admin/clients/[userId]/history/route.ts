import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    await assertStaffPermission("users.clients.read", request);
    const { userId } = await context.params;
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 50), 1),
      200
    );

    const { data, error } = await supabase
      .from("admin_audit_logs")
      .select(
        "id, admin_user_id, action, target_type, target_id, old_values, new_values, ip_address, created_at"
      )
      .eq("target_type", "client")
      .eq("target_id", userId)
      .order("created_at", { ascending: false })
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
