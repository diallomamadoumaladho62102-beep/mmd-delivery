import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageAdmins,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { STAFF_ROLES } from "@/lib/adminRbac";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.admins.manage", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, full_name, email, phone, created_at")
      .in("role", [...STAFF_ROLES])
      .order("created_at", { ascending: false });

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

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageAdmins(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      role?: string;
    };

    const userId = String(body.userId ?? "").trim();
    const newRole = String(body.role ?? "").trim().toLowerCase();

    if (!userId) return json({ ok: false, error: "userId required" }, 400);
    if (!(STAFF_ROLES as readonly string[]).includes(newRole)) {
      return json({ ok: false, error: "invalid staff role" }, 400);
    }

    const { data: before, error: readErr } = await supabase
      .from("profiles")
      .select("id, role, full_name, email")
      .eq("id", userId)
      .maybeSingle();

    if (readErr || !before) {
      return json({ ok: false, error: "profile not found" }, 404);
    }

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId)
      .select("id, role, full_name, email")
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_role_changed",
      targetType: "admin",
      targetId: userId,
      oldValues: { role: before.role },
      newValues: { role: newRole },
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
