import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isTransactionalEmailEnabled, notifyPasswordResetEmail } from "@/lib/transactionalEmails";
import { loadPreferredLocale } from "@/lib/userLocale";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedResetRedirectBase(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "https://www.mmddelivery.com";
}

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
    } | null;

    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
    }

    if (!isTransactionalEmailEnabled()) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const admin = buildSupabaseAdminClient();
    const redirectTo = `${allowedResetRedirectBase()}/auth/reset-password`;

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    if (error || !data?.properties?.action_link) {
      // Generic response — do not reveal whether the email exists.
      return NextResponse.json({ ok: true, skipped: false });
    }

    const finalResetUrl = String(data.properties.action_link);

    const locale = data.user?.id
      ? await loadPreferredLocale(admin, data.user.id)
      : "en";

    const result = await notifyPasswordResetEmail({
      to: email,
      resetUrl: finalResetUrl,
      locale,
    });

    return NextResponse.json({ ok: result.ok, skipped: result.skipped ?? false });
  } catch (error) {
    console.error("[auth/transactional/password-reset]", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
