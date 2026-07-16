import { NextRequest } from "next/server";
import { driverAcceptJson, requireDriverAcceptUser } from "@/lib/driverAcceptApi";
import {
  registerSelfieUpload,
  resolveSelfiePathForCheck,
  submitDriverIdentityCheck,
} from "@/lib/driverIdentityService";
import { IDENTITY_SELFIE_BUCKET } from "@/lib/driverIdentityTypes";
import {
  IDENTITY_SELFIE_MAX_BYTES,
  IDENTITY_SELFIE_MIME_ALLOWLIST,
  isAllowedMime,
  normalizeMime,
  validateIdentitySelfiePath,
} from "@/lib/uploadSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

async function assertSelfieObjectExists(params: {
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => {
        list: (
          path: string,
          opts: { search: string; limit: number }
        ) => Promise<{
          data: Array<{ name?: string; metadata?: { size?: number; mimetype?: string } }> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  path: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const folder = params.path.includes("/")
    ? params.path.slice(0, params.path.lastIndexOf("/"))
    : "";
  const fileName = params.path.includes("/")
    ? params.path.slice(params.path.lastIndexOf("/") + 1)
    : params.path;

  const { data, error } = await params.supabaseAdmin.storage
    .from(IDENTITY_SELFIE_BUCKET)
    .list(folder, { search: fileName, limit: 20 });

  if (error) return { ok: false, error: "selfie_storage_lookup_failed" };
  const match = (data ?? []).find((row) => row.name === fileName);
  if (!match) return { ok: false, error: "selfie_missing" };

  const size = Number(match.metadata?.size ?? 0);
  if (Number.isFinite(size) && size > IDENTITY_SELFIE_MAX_BYTES) {
    return { ok: false, error: "selfie_too_large" };
  }

  const mimetype = normalizeMime(match.metadata?.mimetype);
  if (mimetype && !isAllowedMime(mimetype, IDENTITY_SELFIE_MIME_ALLOWLIST)) {
    return { ok: false, error: "selfie_mime_not_allowed" };
  }

  return { ok: true };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await requireDriverAcceptUser(req);
  if (auth.ok === false) return auth.response;

  const { checkId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "prepare_upload").trim().toLowerCase();
  const ext = String(body.ext ?? "jpg").trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

  try {
    if (action === "prepare_upload") {
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
        return driverAcceptJson({ ok: false, error: "invalid_extension" }, 400);
      }
      const path = resolveSelfiePathForCheck(
        auth.user.id,
        checkId,
        ext === "jpeg" ? "jpg" : ext
      );
      return driverAcceptJson({
        ok: true,
        bucket: IDENTITY_SELFIE_BUCKET,
        path,
        check_id: checkId,
        max_bytes: IDENTITY_SELFIE_MAX_BYTES,
        allowed_mime_types: IDENTITY_SELFIE_MIME_ALLOWLIST,
      });
    }

    if (action === "register_upload") {
      const path = String(body.path ?? "").trim();
      if (!path) {
        return driverAcceptJson({ ok: false, error: "path_required" }, 400);
      }
      const pathCheck = validateIdentitySelfiePath({
        userId: auth.user.id,
        path,
      });
      if (pathCheck.ok === false) {
        return driverAcceptJson({ ok: false, error: pathCheck.error }, 403);
      }

      const objectCheck = await assertSelfieObjectExists({
        supabaseAdmin: auth.supabaseAdmin,
        path,
      });
      if (objectCheck.ok === false) {
        return driverAcceptJson({ ok: false, error: objectCheck.error }, 400);
      }

      const check = await registerSelfieUpload(
        auth.supabaseAdmin,
        auth.user.id,
        checkId,
        path
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
        checkId
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
      message === "check_not_found"
        ? 404
        : message === "check_not_uploadable" ||
            message === "check_not_submittable" ||
            message === "selfie_missing"
          ? 409
          : 500;
    return driverAcceptJson({ ok: false, error: message }, status);
  }
}
