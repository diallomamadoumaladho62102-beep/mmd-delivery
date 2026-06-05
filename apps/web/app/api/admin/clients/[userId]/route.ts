import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageClients,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ClientAction = "suspend" | "unsuspend" | "activate" | "deactivate" | "update";

const STATUS_BY_ACTION: Record<string, string> = {
  suspend: "suspended",
  unsuspend: "active",
  activate: "active",
  deactivate: "disabled",
};

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

    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, full_name, email, phone, account_status, created_at")
      .eq("id", userId)
      .eq("role", "client")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Client not found" }, 404);

    return json({ ok: true, item: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await assertCanManageClients(request);
    const { userId } = await context.params;
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      action?: ClientAction;
      full_name?: string;
      phone?: string;
      email?: string;
    };

    const action = String(body.action ?? "update").trim().toLowerCase() as ClientAction;

    const { data: before, error: readErr } = await supabase
      .from("profiles")
      .select("id, role, full_name, email, phone, account_status")
      .eq("id", userId)
      .eq("role", "client")
      .maybeSingle();

    if (readErr || !before) {
      return json({ ok: false, error: "Client not found" }, 404);
    }

    const updates: Record<string, unknown> = {};

    if (action !== "update") {
      const nextStatus = STATUS_BY_ACTION[action];
      if (!nextStatus) return json({ ok: false, error: "Invalid action" }, 400);
      updates.account_status = nextStatus;
    } else {
      if (typeof body.full_name === "string") {
        updates.full_name = body.full_name.trim() || null;
      }
      if (typeof body.phone === "string") {
        updates.phone = body.phone.trim() || null;
      }
      if (typeof body.email === "string" && body.email.trim()) {
        const email = body.email.trim().toLowerCase();
        updates.email = email;
        const { error: authErr } = await supabase.auth.admin.updateUserById(userId, {
          email,
        });
        if (authErr) {
          return json({ ok: false, error: authErr.message }, 500);
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return json({ ok: false, error: "No changes" }, 400);
    }

    const { data: updated, error: updErr } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, role, full_name, email, phone, account_status, created_at")
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    const auditAction =
      action === "update" ? "client_updated" : `client_${action}`;

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: auditAction,
      targetType: "client",
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
