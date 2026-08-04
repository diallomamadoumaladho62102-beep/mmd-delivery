import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { resolveRequestUser } from "@/lib/requestUser";
import {
  isPhoneOtpEnabled,
  isTwilioVerifyConfigured,
  startPhoneVerification,
} from "@/lib/twilioVerify";

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
          error: "Phone OTP is not enabled",
          code: "phone_otp_disabled",
        },
        403,
      );
    }
    if (!isTwilioVerifyConfigured()) {
      return json(
        {
          ok: false,
          error: "Twilio Verify is not configured",
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
