import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { resolveRequestUser } from "@/lib/requestUser";
import { isPhoneOptedOut } from "@/lib/smsConsent";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  isPhoneOtpEnabled,
  isTwilioVerifyConfigured,
  startPhoneVerification,
} from "@/lib/twilioVerify";
import { normalizePhoneE164 } from "@/lib/phoneE164";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    if (!isPhoneOtpEnabled()) {
      return json(
        {
          ok: false,
          error: "Phone verification is temporarily unavailable.",
          code: "phone_otp_disabled",
        },
        403,
      );
    }
    if (!isTwilioVerifyConfigured()) {
      return json(
        {
          ok: false,
          error: "Phone verification is temporarily unavailable.",
          code: "verify_not_configured",
        },
        503,
      );
    }

    const user = await resolveRequestUser(request);
    if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

    const rate = checkRateLimit({
      namespace: "phone-otp-start",
      key: user.id,
      limit: 5,
      windowMs: 60_000,
    });
    if (rate.limited) {
      return json(
        { ok: false, error: "Too many attempts. Try again later." },
        429,
      );
    }

    const body = (await request.json().catch(() => ({}))) as { phone?: string };
    const phone = String(body.phone ?? "").trim();
    const phoneE164 = normalizePhoneE164(phone);
    if (phoneE164) {
      const phoneRate = checkRateLimit({
        namespace: "phone-otp-start-phone",
        key: phoneE164,
        limit: 3,
        windowMs: 10 * 60_000,
      });
      const ipRate = checkRateLimit({
        namespace: "phone-otp-start-ip",
        key: getRequestClientIp(request.headers),
        limit: 8,
        windowMs: 60 * 60_000,
      });
      if (phoneRate.limited || ipRate.limited) {
        return json(
          { ok: false, error: "Too many attempts. Try again later." },
          429,
        );
      }
      if (await isPhoneOptedOut(buildSupabaseAdminClient(), phoneE164)) {
        return json(
          {
            ok: false,
            error: "This number is opted out of SMS. Reply START or opt in at /legal/sms.",
            code: "sms_opted_out",
          },
          403,
        );
      }
    }
    const started = await startPhoneVerification({ phone });
    if (!started.ok) {
      return json(
        { ok: false, error: started.error ?? "Failed to start verification" },
        400,
      );
    }

    return json({ ok: true, phone_e164: started.phoneE164 });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}
