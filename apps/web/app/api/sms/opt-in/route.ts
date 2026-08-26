import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { canSendUsA2pSms } from "@/lib/smsA2p";
import {
  assertExplicitConsentChecked,
  recordSmsConsent,
} from "@/lib/smsConsent";
import { sendProgramSms } from "@/lib/smsOutbound";
import { renderSmsTemplate } from "@/lib/smsTemplates";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const ip = getRequestClientIp(request.headers);
  const ipRate = checkRateLimit({
    namespace: "sms-public-opt-in",
    key: ip,
    limit: 8,
    windowMs: 60 * 60 * 1000,
  });
  if (ipRate.limited) {
    return json({ ok: false, error: "Too many attempts. Try again later." }, 429);
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    consent?: unknown;
    locale?: string;
    source?: string;
  };

  if (!assertExplicitConsentChecked(body.consent)) {
    return json(
      {
        ok: false,
        error: "SMS consent checkbox must be checked to opt in.",
        code: "consent_required",
      },
      400,
    );
  }

  const source =
    body.source === "web_signup" || body.source === "mobile_signup"
      ? body.source
      : "public_cta";

  const supabase = buildSupabaseAdminClient();
  const recorded = await recordSmsConsent(supabase, {
    phone: String(body.phone ?? ""),
    consented: true,
    source,
    ipAddress: ip === "unknown" ? null : ip,
    userAgent: request.headers.get("user-agent"),
  });

  if (recorded.ok === false) {
    return json(
      {
        ok: false,
        error:
          recorded.error === "invalid_phone"
            ? "Enter a valid mobile number."
            : "Unable to save SMS consent.",
        code: recorded.error,
      },
      400,
    );
  }

  let confirmation: "sent" | "skipped" = "skipped";
  if (canSendUsA2pSms().ok) {
    const sent = await sendProgramSms({
      supabase,
      to: recorded.phoneE164,
      body: renderSmsTemplate("opt_in_confirm"),
      messageType: "opt_in_confirm",
      idempotencyKey: `opt_in_confirm:${recorded.phoneE164}:${new Date().toISOString().slice(0, 10)}`,
    });
    if (sent.ok && !sent.skipped) confirmation = "sent";
  }

  return json({
    ok: true,
    consented: true,
    confirmation,
    program: "MMD Delivery",
  });
}
