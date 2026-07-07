import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  acquireIdentityCheckLock,
  IdentityCheckLockError,
  releaseIdentityCheckLock,
} from "@/lib/driverIdentityOps";
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

  const { checkId } = await context.params;
  const admin = buildSupabaseAdminClient();

  try {
    const check = await acquireIdentityCheckLock(admin, checkId, staff.userId);
    return adminJson({
      ok: true,
      lock: {
        locked_by: check.locked_by,
        lock_expires_at: check.lock_expires_at,
        review_started_at: check.review_started_at,
      },
    });
  } catch (error) {
    if (error instanceof IdentityCheckLockError) {
      return adminJson(
        { ok: false, error: error.message, locked_by: error.lockedBy },
        error.status,
      );
    }
    const message = error instanceof Error ? error.message : "lock_failed";
    return adminJson({ ok: false, error: message }, message === "check_not_found" ? 404 : 500);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.manage", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const { checkId } = await context.params;
  const admin = buildSupabaseAdminClient();

  try {
    await releaseIdentityCheckLock(admin, checkId, staff.userId);
    return adminJson({ ok: true });
  } catch (error) {
    if (error instanceof IdentityCheckLockError) {
      return adminJson(
        { ok: false, error: error.message, locked_by: error.lockedBy },
        error.status,
      );
    }
    return adminJson({ ok: false, error: "release_failed" }, 500);
  }
}
