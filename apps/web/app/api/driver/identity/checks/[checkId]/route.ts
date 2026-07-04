import { NextRequest } from "next/server";
import { driverAcceptJson, requireDriverAcceptUser } from "@/lib/driverAcceptApi";
import {
  registerSelfieUpload,
  resolveSelfiePathForCheck,
  submitDriverIdentityCheck,
} from "@/lib/driverIdentityService";
import { IDENTITY_SELFIE_BUCKET } from "@/lib/driverIdentityTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await requireDriverAcceptUser(req);
  if (auth.ok === false) return auth.response;

  const { checkId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "prepare_upload").trim().toLowerCase();
  const ext = String(body.ext ?? "jpg").trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

  try {
    if (action === "prepare_upload") {
      const path = resolveSelfiePathForCheck(auth.user.id, checkId, ext);
      return driverAcceptJson({
        ok: true,
        bucket: IDENTITY_SELFIE_BUCKET,
        path,
        check_id: checkId,
      });
    }

    if (action === "register_upload") {
      const path = String(body.path ?? "").trim();
      if (!path) {
        return driverAcceptJson({ ok: false, error: "path_required" }, 400);
      }
      if (!path.startsWith(`drivers/${auth.user.id}/`)) {
        return driverAcceptJson({ ok: false, error: "invalid_path" }, 403);
      }

      const check = await registerSelfieUpload(
        auth.supabaseAdmin,
        auth.user.id,
        checkId,
        path,
      );

      return driverAcceptJson({
        ok: true,
        check: {
          id: check.id,
          status: check.status,
          selfie_path: check.selfie_path,
        },
      });
    }

    if (action === "submit") {
      const check = await submitDriverIdentityCheck(
        auth.supabaseAdmin,
        auth.user.id,
        checkId,
      );

      return driverAcceptJson({
        ok: true,
        check: {
          id: check.id,
          status: check.status,
          submitted_at: check.submitted_at,
          verified_at: check.verified_at,
        },
        gate_status: check.status === "verified" ? "verified" : check.status,
      });
    }

    return driverAcceptJson({ ok: false, error: "invalid_action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "selfie_action_failed";
    const status =
      message === "check_not_found" ? 404 :
      message === "check_not_uploadable" || message === "check_not_submittable" || message === "selfie_missing" ? 409 :
      500;
    return driverAcceptJson({ ok: false, error: message }, status);
  }
}
