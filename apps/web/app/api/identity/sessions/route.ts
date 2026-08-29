import { NextRequest } from "next/server";
import {
  createIdentitySession,
  getIdentityStatus,
} from "@/lib/identityVerification";
import {
  parseIdentitySubjectType,
  requireIdentityActor,
} from "@/lib/identityVerification/auth";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";
import { assertSafeAppReturnUrl } from "@/lib/safeReturnUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/identity/sessions
 * Creates a Stripe Identity VerificationSession via the provider module.
 */
export async function POST(req: NextRequest) {
  const auth = await requireIdentityActor(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const subjectType =
    parseIdentitySubjectType(body.subject_type ?? body.subjectType) ??
    parseIdentitySubjectType(auth.role);

  if (!subjectType) {
    return json({ ok: false, error: "invalid_subject_type" }, 400);
  }

  // Users may only create sessions for themselves (admin uses /api/admin/identity).
  if (subjectType !== auth.role && auth.role !== "admin") {
    // Allow restaurant owners whose profile.role is restaurant, etc.
    if (auth.role && auth.role !== subjectType) {
      return json({ ok: false, error: "forbidden_subject" }, 403);
    }
  }

  const featureKey = String(body.feature_key ?? body.featureKey ?? "default").trim() || "default";
  const rawReturnUrl =
    typeof body.return_url === "string"
      ? body.return_url
      : typeof body.returnUrl === "string"
        ? body.returnUrl
        : null;
  let returnUrl: string | null = null;
  if (rawReturnUrl) {
    const allowed = assertSafeAppReturnUrl(rawReturnUrl);
    if (allowed.ok === false) {
      return json({ ok: false, error: "invalid_return_url" }, 403);
    }
    returnUrl = allowed.url;
  }

  try {
    const result = await createIdentitySession(auth.supabaseAdmin, {
      subjectUserId: auth.userId,
      subjectType,
      featureKey,
      email: auth.email,
      phone: auth.phone,
      returnUrl,
    });

    if (!result.ok) {
      return json(result, 400);
    }

    // Strip any client_secret — mobile may only receive sessionId, url, ephemeralKeySecret.
    const { clientSecret: _omitSecret, ...safe } = result;
    return json(safe);
  } catch (error) {
    logTechnicalError("identity.sessions.create", error, {
      userId: auth.userId,
      subjectType,
    });
    return json(
      {
        ok: false,
        error: "identity_session_create_failed",
        message: toUserFacingError(
          error,
          "Impossible de démarrer la vérification d'identité."
        ),
      },
      500
    );
  }
}

/**
 * GET /api/identity/sessions?subject_type=&feature_key=
 * Convenience alias for status during an active session.
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
    logTechnicalError("identity.sessions.status", error, {
      userId: auth.userId,
      subjectType,
    });
    return json({ ok: false, error: "identity_status_failed" }, 500);
  }
}
