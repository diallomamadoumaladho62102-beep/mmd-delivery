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
} from "@/lib/adminGovernance";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  CREATABLE_STAFF_ROLES,
  STAFF_ROLES,
  SUPER_ADMIN_ROLE,
  normalizeStaffRole,
} from "@/lib/adminRbac";
import { ensureStaffAuthUserAndSendInvite } from "@/lib/staffAdminInvite";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type AdminAction =
  | "change_role"
  | "suspend"
  | "unsuspend"
  | "activate"
  | "deactivate"
  | "update_profile"
  | "resend_invite";

const STATUS_BY_ACTION: Record<string, string> = {
  suspend: "suspended",
  unsuspend: "active",
  activate: "active",
  deactivate: "disabled",
};

/** Query both canonical and legacy short staff roles until DB is fully migrated. */
const STAFF_ROLE_QUERY = [
  ...STAFF_ROLES,
  "admin",
  "ops",
  "finance",
  "support",
  "review",
  "founder",
] as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const STAFF_PROFILE_SELECT =
  "id, role, full_name, email, phone, account_status, is_founder, created_at, staff_country_code, staff_region_code, staff_county_code, staff_city, staff_timezone, staff_language, staff_department, staff_title, last_seen_at, presence_status";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.admins.manage", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("profiles")
      .select(STAFF_PROFILE_SELECT)
      .in("role", [...STAFF_ROLE_QUERY])
      .order("created_at", { ascending: false });

    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) => ({
      ...row,
      role: normalizeStaffRole(row.role) ?? row.role,
    }));

    const role_counts = Object.fromEntries(
      STAFF_ROLES.map((role) => [
        role,
        items.filter((row) => normalizeStaffRole(row.role) === role).length,
      ])
    );

    return json({
      ok: true,
      items,
      role_counts,
      total: items.length,
      note:
        "Founder and staff with users.admins.manage see 100% of administrators; no role is hidden by RBAC on this list.",
    });
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
    const newRole = normalizeStaffRole(body.role);
    const fullName = String(body.full_name ?? "").trim() || null;

    if (!email) return json({ ok: false, error: "email required" }, 400);
    if (!newRole) {
      return json({ ok: false, error: "invalid staff role" }, 400);
    }
    if (
      newRole === SUPER_ADMIN_ROLE ||
      !(CREATABLE_STAFF_ROLES as readonly string[]).includes(newRole)
    ) {
      return json(
        {
          ok: false,
          error: "Use role change on an existing Super Admin only",
        },
        400
      );
    }

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, role, account_status, is_founder, email, full_name")
      .eq("email", email)
      .maybeSingle();

    if (existingProfile && normalizeStaffRole(existingProfile.role)) {
      return json(
        { ok: false, error: "User is already a staff administrator" },
        400
      );
    }

    const { data: actorProfile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", session.userId)
      .maybeSingle();

    let invite;
    try {
      invite = await ensureStaffAuthUserAndSendInvite({
        supabaseAdmin: supabase,
        email,
        fullName,
        role: newRole,
        invitedByName:
          actorProfile?.full_name || actorProfile?.email || "Founder",
        existingUserId: existingProfile?.id ? String(existingProfile.id) : null,
      });
    } catch (err) {
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Failed to create auth user",
        },
        500
      );
    }

    const userId = invite.userId;

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
      newValues: {
        ...(updated as Record<string, unknown>),
        invite_sent: invite.inviteSent,
        invite_skipped: invite.inviteSkipped,
        auth_user_created: invite.createdAuthUser,
      },
      request,
    });

    return json({
      ok: true,
      item: updated,
      invite: {
        sent: invite.inviteSent,
        skipped: invite.inviteSkipped,
        auth_user_created: invite.createdAuthUser,
        error: invite.inviteError ?? null,
      },
    });
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
      staff_country_code?: string | null;
      staff_region_code?: string | null;
      staff_county_code?: string | null;
      staff_city?: string | null;
      staff_timezone?: string | null;
      staff_language?: string | null;
      staff_department?: string | null;
      staff_title?: string | null;
    };

    const userId = String(body.userId ?? "").trim();
    const action = String(body.action ?? "change_role").trim() as AdminAction;
    const newRole = body.role != null ? normalizeStaffRole(body.role) : null;

    if (!userId) return json({ ok: false, error: "userId required" }, 400);

    if (action !== "update_profile" && action !== "resend_invite") {
      assertNotSelfTarget(session.userId, userId, action.replace("_", " "));
    }

    const before = await assertTargetIsStaffAdmin(supabase, userId);
    if (action !== "resend_invite") {
      await assertFounderProtected(supabase, before, action.replace("_", " "));
    }

    if (action === "resend_invite") {
      const staffRole = normalizeStaffRole(before.role);
      if (!staffRole || staffRole === SUPER_ADMIN_ROLE) {
        return json(
          { ok: false, error: "Invite can only be resent for creatable staff roles" },
          400
        );
      }
      if (!before.email) {
        return json({ ok: false, error: "Administrator has no email" }, 400);
      }

      const { data: actorProfile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", session.userId)
        .maybeSingle();

      let invite;
      try {
        invite = await ensureStaffAuthUserAndSendInvite({
          supabaseAdmin: supabase,
          email: String(before.email),
          fullName: before.full_name,
          role: staffRole,
          invitedByName:
            actorProfile?.full_name || actorProfile?.email || "Founder",
          existingUserId: userId,
        });
      } catch (err) {
        return json(
          {
            ok: false,
            error:
              err instanceof Error ? err.message : "Failed to resend invite",
          },
          500
        );
      }

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "admin_invite_resent",
        targetType: "admin",
        targetId: userId,
        oldValues: before as Record<string, unknown>,
        newValues: {
          invite_sent: invite.inviteSent,
          invite_skipped: invite.inviteSkipped,
          invite_error: invite.inviteError ?? null,
        },
        request,
      });

      return json({
        ok: true,
        item: before,
        invite: {
          sent: invite.inviteSent,
          skipped: invite.inviteSkipped,
          auth_user_created: invite.createdAuthUser,
          error: invite.inviteError ?? null,
        },
      });
    }

    const updates: Record<string, unknown> = {};
    const beforeStaffRole = normalizeStaffRole(before.role);

    if (action === "change_role") {
      if (!newRole) return json({ ok: false, error: "role required" }, 400);
      if (!(STAFF_ROLES as readonly string[]).includes(newRole)) {
        return json({ ok: false, error: "invalid staff role" }, 400);
      }
      if (
        beforeStaffRole === SUPER_ADMIN_ROLE &&
        newRole !== SUPER_ADMIN_ROLE
      ) {
        return json(
          { ok: false, error: "Super Admin role cannot be changed" },
          403
        );
      }
      if (
        newRole === SUPER_ADMIN_ROLE &&
        beforeStaffRole !== SUPER_ADMIN_ROLE
      ) {
        return json(
          { ok: false, error: "Cannot promote to Super Admin via API" },
          403
        );
      }
      updates.role = newRole;
    } else if (action === "update_profile") {
      const geoKeys = [
        "staff_country_code",
        "staff_region_code",
        "staff_county_code",
        "staff_city",
        "staff_timezone",
        "staff_language",
        "staff_department",
        "staff_title",
      ] as const;
      for (const key of geoKeys) {
        if (body[key] !== undefined) {
          const raw = body[key];
          updates[key] =
            raw == null || raw === ""
              ? null
              : String(raw).trim().slice(0, 120);
        }
      }
      if (!Object.keys(updates).length) {
        return json({ ok: false, error: "No profile fields to update" }, 400);
      }
    } else {
      const nextStatus = STATUS_BY_ACTION[action];
      if (!nextStatus) return json({ ok: false, error: "Invalid action" }, 400);
      updates.account_status = nextStatus;
    }

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select(STAFF_PROFILE_SELECT)
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
