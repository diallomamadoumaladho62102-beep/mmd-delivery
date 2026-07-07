import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { assignIdentityCheck } from "@/lib/driverIdentityOps";
import { isAdmin } from "@/lib/roles";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, context: RouteContext) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.manage", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  if (!isAdmin(staff.role)) {
    return adminJson({ ok: false, error: "Super Admin required" }, 403);
  }

  const { checkId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const assigneeUserId = String(body.assignee_user_id ?? body.assigned_to ?? "").trim();

  if (!assigneeUserId) {
    return adminJson({ ok: false, error: "assignee_user_id_required" }, 400);
  }

  const admin = buildSupabaseAdminClient();

  try {
    const check = await assignIdentityCheck(
      admin,
      checkId,
      assigneeUserId,
      staff.userId,
    );

    await writeAdminAuditServer({
      supabaseAdmin: admin,
      adminUserId: staff.userId,
      action: "driver_identity.assign",
      targetType: "driver_identity_check",
      targetId: checkId,
      metadata: { assigned_to: assigneeUserId },
      request: req,
    });

    return adminJson({ ok: true, check });
  } catch (error) {
    const message = error instanceof Error ? error.message : "assign_failed";
    return adminJson({ ok: false, error: message }, message === "invalid_assignee" ? 400 : 500);
  }
}
