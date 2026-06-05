import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.clients.read", request);
    const supabase = buildSupabaseAdminClient();
    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1), 200);

    let query = supabase
      .from("profiles")
      .select("id, role, full_name, email, phone, account_status, created_at")
      .eq("role", "client")
      .order("created_at", { ascending: false })
      .limit(limit);

    const { data, error } = await query;

    if (error) return json({ ok: false, error: error.message }, 500);

    let items = (data ?? []).map((row) => ({ ...row }));

    await Promise.all(
      items.map(async (row) => {
        if (row.email) return;
        const { data: authUser } = await supabase.auth.admin.getUserById(row.id);
        if (authUser?.user?.email) {
          row.email = authUser.user.email;
        }
      })
    );
    if (q) {
      items = items.filter((row) => {
        const blob = `${row.full_name ?? ""} ${row.email ?? ""} ${row.phone ?? ""} ${row.id}`.toLowerCase();
        return blob.includes(q);
      });
    }

    return json({ ok: true, items });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
