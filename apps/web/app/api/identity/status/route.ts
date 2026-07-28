import { NextRequest } from "next/server";
import { getIdentityStatus } from "@/lib/identityVerification";
import {
  parseIdentitySubjectType,
  requireIdentityActor,
} from "@/lib/identityVerification/auth";
import { logTechnicalError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * GET /api/identity/status?subject_type=driver&feature_key=default
 */
export async function GET(req: NextRequest) {
  const auth = await requireIdentityActor(req);
  if (!auth.ok) return auth.response;

  const subjectType =
    parseIdentitySubjectType(req.nextUrl.searchParams.get("subject_type")) ??
    parseIdentitySubjectType(auth.role);

  if (!subjectType) {
    return json({ ok: false, error: "invalid_subject_type" }, 400);
  }

  const featureKey =
    String(req.nextUrl.searchParams.get("feature_key") ?? "default").trim() ||
    "default";

  try {
    const status = await getIdentityStatus(
      auth.supabaseAdmin,
      auth.userId,
      subjectType,
      featureKey
    );
    return json(status);
  } catch (error) {
    logTechnicalError("identity.status", error, {
      userId: auth.userId,
      subjectType,
    });
    return json({ ok: false, error: "identity_status_failed" }, 500);
  }
}
