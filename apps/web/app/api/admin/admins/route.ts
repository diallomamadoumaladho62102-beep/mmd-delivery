import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageAdmins,
  assertStaffPermission,
} from "@/lib/adminServer";
import {
  assertFounderProtected,
  assertNotSelfTarget,
  assertTargetIsStaffAdmin,
  loadStaffProfile,
} from "@/lib/adminGovernance";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { STAFF_ROLES } from "@/lib/adminRbac";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type AdminAction =
  | "change_role"
  | "suspend"
  | "unsuspend"
  | "activate"
  | "deactivate";

const STATUS_BY_ACTION: Record<string, string> = {
  suspend: "suspended",
  unsuspend: "active",
  activate: "active",
  deactivate: "disabled",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.admins.manage", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, role, full_name, email, phone, account_status, is_founder, created_at"
      )
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

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanManageAdmins(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role?: string;
      full_name?: string;
    };

    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const newRole = String(body.role ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim() || null;

    if (!email) return json({ ok: false, error: "email required" }, 400);
    if (!(STAFF_ROLES as readonly string[]).includes(newRole)) {
      return json({ ok: false, error: "invalid staff role" }, 400);
    }
    if (newRole === "admin") {
      return json(
        { ok: false, error: "Use role change on an existing Super Admin only" },
        400
      );
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, role, account_status, is_founder, email, full_name")
      .eq("email", email)
      .maybeSingle();

    let userId = existingProfile?.id ? String(existingProfile.id) : "";

    if (!userId) {
      const { data: created, error: createErr } =
        await supabase.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: fullName ? { full_name: fullName } : undefined,
        });

      if (createErr || !created.user?.id) {
        return json(
          { ok: false, error: createErr?.message ?? "Failed to create user" },
          500
        );
      }
      userId = created.user.id;
    }

    if (
      existingProfile &&
      (STAFF_ROLES as readonly string[]).includes(String(existingProfile.role ?? ""))
    ) {
      return json({ ok: false, error: "User is already a staff administrator" }, 400);
    }

    const before = existingProfile ?? {
      id: userId,
      role: null,
      account_status: "active",
      is_founder: false,
      email,
      full_name: fullName,
    };

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          email,
          full_name: fullName ?? before.full_name,
          role: newRole,
          account_status: "active",
          is_founder: false,
        },
        { onConflict: "id" }
      )
      .select(
        "id, role, full_name, email, phone, account_status, is_founder, created_at"
      )
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_created",
      targetType: "admin",
      targetId: userId,
      oldValues: before as Record<string, unknown>,
      newValues: updated as Record<string, unknown>,
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

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageAdmins(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      role?: string;
      action?: AdminAction;
    };

    const userId = String(body.userId ?? "").trim();
    const action = String(body.action ?? "change_role").trim() as AdminAction;
    const newRole = String(body.role ?? "").trim().toLowerCase();

    if (!userId) return json({ ok: false, error: "userId required" }, 400);

    assertNotSelfTarget(session.userId, userId, action.replace("_", " "));

    const before = await assertTargetIsStaffAdmin(supabase, userId);
    await assertFounderProtected(supabase, before, action.replace("_", " "));

    const updates: Record<string, unknown> = {};

    if (action === "change_role") {
      if (!newRole) return json({ ok: false, error: "role required" }, 400);
      if (!(STAFF_ROLES as readonly string[]).includes(newRole)) {
        return json({ ok: false, error: "invalid staff role" }, 400);
      }
      if (before.role === "admin" && newRole !== "admin") {
        return json(
          { ok: false, error: "Super Admin role cannot be changed" },
          403
        );
      }
      if (newRole === "admin" && before.role !== "admin") {
        return json(
          { ok: false, error: "Cannot promote to Super Admin via API" },
          403
        );
      }
      updates.role = newRole;
    } else {
      const nextStatus = STATUS_BY_ACTION[action];
      if (!nextStatus) return json({ ok: false, error: "Invalid action" }, 400);
      updates.account_status = nextStatus;
    }

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select(
        "id, role, full_name, email, phone, account_status, is_founder, created_at"
      )
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    const auditAction =
      action === "change_role" ? "admin_role_changed" : `admin_${action}`;

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: auditAction,
      targetType: "admin",
      targetId: userId,
      oldValues: before as Record<string, unknown>,
      newValues: updated as Record<string, unknown>,
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

export async function DELETE(request: NextRequest) {
  try {
    const session = await assertCanManageAdmins(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
    };
    const userId = String(body.userId ?? "").trim();

    if (!userId) return json({ ok: false, error: "userId required" }, 400);

    assertNotSelfTarget(session.userId, userId, "delete");

    const before = await assertTargetIsStaffAdmin(supabase, userId);
    await assertFounderProtected(supabase, before, "delete");

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update({ role: "client", account_status: "active", is_founder: false })
      .eq("id", userId)
      .select(
        "id, role, full_name, email, phone, account_status, is_founder, created_at"
      )
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "admin_deleted",
      targetType: "admin",
      targetId: userId,
      oldValues: before as Record<string, unknown>,
      newValues: updated as Record<string, unknown>,
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
