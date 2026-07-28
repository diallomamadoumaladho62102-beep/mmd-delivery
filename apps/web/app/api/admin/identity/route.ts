import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import {
  adminRequestReverification,
  getIdentityStatus,
  isIdentitySubjectType,
} from "@/lib/identityVerification";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { logTechnicalError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * GET /api/admin/identity?status=&subject_type=&q=
 */
export async function GET(req: NextRequest) {
  try {
    await assertStaffPermission("drivers.identity.read", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const supabase = buildSupabaseAdminClient();
  const status = String(req.nextUrl.searchParams.get("status") ?? "").trim();
  const subjectType = String(
    req.nextUrl.searchParams.get("subject_type") ?? ""
  ).trim();
  const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Math.min(
    200,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50)
  );

  let query = supabase
    .from("identity_verifications")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("verification_status", status);
  if (subjectType) query = query.eq("subject_type", subjectType);
  if (q) query = query.or(`subject_user_id.eq.${q},active_session_id.eq.${q}`);

  const { data, error } = await query;
  if (error) {
    logTechnicalError("admin.identity.list", error);
    return adminJson({ ok: false, error: "list_failed" }, 500);
  }

  return adminJson({ ok: true, items: data ?? [] });
}

/**
 * POST /api/admin/identity
 * body: { action: "reverify"|"status", subject_user_id, subject_type, feature_key?, reason? }
 */
export async function POST(req: NextRequest) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.manage", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return adminJson({ ok: false, error: "invalid_json" }, 400);
  }

  const action = String(body.action ?? "").trim();
  const subjectUserId = String(
    body.subject_user_id ?? body.subjectUserId ?? ""
  ).trim();
  const subjectTypeRaw = String(
    body.subject_type ?? body.subjectType ?? ""
  ).trim();
  const featureKey =
    String(body.feature_key ?? body.featureKey ?? "default").trim() || "default";

  if (!subjectUserId || !isIdentitySubjectType(subjectTypeRaw)) {
    return adminJson({ ok: false, error: "invalid_subject" }, 400);
  }

  const supabase = buildSupabaseAdminClient();

  try {
    if (action === "status") {
      const status = await getIdentityStatus(
        supabase,
        subjectUserId,
        subjectTypeRaw,
        featureKey
      );
      return adminJson(status);
    }

    if (action === "reverify") {
      const result = await adminRequestReverification(supabase, {
        subjectUserId,
        subjectType: subjectTypeRaw,
        featureKey,
        adminUserId: staff.userId,
        reason: typeof body.reason === "string" ? body.reason : null,
      });
      return adminJson(result, result.ok ? 200 : 400);
    }

    return adminJson({ ok: false, error: "unknown_action" }, 400);
  } catch (error) {
    logTechnicalError("admin.identity.post", error);
    return adminJson({ ok: false, error: "admin_identity_failed" }, 500);
  }
}
