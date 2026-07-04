import { NextRequest } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  adminReviewIdentityCheck,
  createSignedSelfieUrl,
} from "@/lib/driverIdentityService";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await assertStaffPermission("drivers.identity.read", _req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const { checkId } = await context.params;
  const admin = buildSupabaseAdminClient();

  const { data: check, error } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .maybeSingle();

  if (error) return adminJson({ ok: false, error: error.message }, 500);
  if (!check) return adminJson({ ok: false, error: "not_found" }, 404);

  const { data: events } = await admin
    .from("driver_identity_events")
    .select("*")
    .eq("check_id", checkId)
    .order("created_at", { ascending: false })
    .limit(100);

  let selfieSignedUrl: string | null = null;
  if (check.selfie_path) {
    try {
      selfieSignedUrl = await createSignedSelfieUrl(admin, check.selfie_path, 600);
    } catch {
      selfieSignedUrl = null;
    }
  }

  const { data: driverProfile } = await admin
    .from("driver_profiles")
    .select("user_id, full_name, phone, city, state, status, is_online")
    .eq("user_id", check.driver_id)
    .maybeSingle();

  return adminJson({
    ok: true,
    check: { ...check, driver_profile: driverProfile ?? null },
    events: events ?? [],
    selfie_signed_url: selfieSignedUrl,
  });
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
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "").trim().toLowerCase();
  const reviewNotes = String(body.review_notes ?? body.notes ?? "").trim() || null;

  const validActions = new Set(["approve", "reject", "request_new_photo", "suspend"]);
  if (!validActions.has(action)) {
    return adminJson({ ok: false, error: "invalid_action" }, 400);
  }

  const admin = buildSupabaseAdminClient();

  try {
    const check = await adminReviewIdentityCheck(admin, {
      checkId,
      adminUserId: staff.userId,
      action: action as "approve" | "reject" | "request_new_photo" | "suspend",
      reviewNotes,
      suspendDriver: action === "suspend",
    });

    await writeAdminAuditServer({
      supabaseAdmin: admin,
      adminUserId: staff.userId,
      action: `driver_identity.${action}`,
      targetType: "driver_identity_check",
      targetId: checkId,
      metadata: { review_notes: reviewNotes, resulting_status: check.status },
      request: req,
    });

    return adminJson({ ok: true, check });
  } catch (error) {
    const message = error instanceof Error ? error.message : "review_failed";
    return adminJson({ ok: false, error: message }, message === "check_not_found" ? 404 : 500);
  }
}
