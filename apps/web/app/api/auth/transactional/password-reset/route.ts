import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isTransactionalEmailEnabled, notifyPasswordResetEmail } from "@/lib/transactionalEmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getRequestClientIp(req.headers);
    const rate = checkRateLimit({
      namespace: "auth-password-reset-email",
      key: ip,
      limit: 10,
      windowMs: 60_000,
    });

    if (rate.limited) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    const body = (await req.json().catch(() => null)) as {
      email?: string;
      resetUrl?: string;
    } | null;

    const email = String(body?.email ?? "").trim().toLowerCase();
    const resetUrl = String(body?.resetUrl ?? "").trim();

    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
    }

    if (!isTransactionalEmailEnabled()) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    let finalResetUrl = resetUrl;

    if (!finalResetUrl) {
      const admin = buildSupabaseAdminClient();
      const redirectTo =
        process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
        "https://mmddelivery.com/auth/reset-password";

      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });

      if (error || !data?.properties?.action_link) {
        return NextResponse.json({ ok: false, error: "Unable to generate reset link" }, { status: 500 });
      }

      finalResetUrl = String(data.properties.action_link);
    }

    const result = await notifyPasswordResetEmail({
      to: email,
      resetUrl: finalResetUrl,
    });

    return NextResponse.json({ ok: result.ok, skipped: result.skipped ?? false });
  } catch (error) {
    console.error("[auth/transactional/password-reset]", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
