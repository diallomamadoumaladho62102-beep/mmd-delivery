import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { resolveRequestUser } from "@/lib/requestUser";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  checkPhoneVerification,
  isPhoneOtpEnabled,
  isTwilioVerifyConfigured,
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
      namespace: "phone-otp-check",
      key: user.id,
      limit: 10,
      windowMs: 60_000,
    });
    if (rate.limited) {
      return json(
        { ok: false, error: "Too many attempts. Try again later." },
        429,
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      phone?: string;
      code?: string;
    };
    const checked = await checkPhoneVerification({
      phone: String(body.phone ?? "").trim(),
      code: String(body.code ?? "").trim(),
    });
    if (!checked.ok || !checked.phoneE164) {
      return json(
        { ok: false, error: checked.error ?? "Verification failed" },
        400,
      );
    }

    const admin = buildSupabaseAdminClient();

    const { data: conflict } = await admin
      .from("profiles")
      .select("id")
      .eq("phone_e164", checked.phoneE164)
      .eq("role", "client")
      .eq("account_status", "active")
      .not("phone_verified_at", "is", null)
      .neq("id", user.id)
      .maybeSingle();

    if (conflict?.id) {
      return json(
        {
          ok: false,
          error: "This phone number is already verified on another account",
          code: "phone_already_verified",
        },
        409,
      );
    }

    const now = new Date().toISOString();
    const { error: updErr } = await admin
      .from("profiles")
      .update({
        phone: checked.phoneE164,
        phone_e164: checked.phoneE164,
        phone_verified_at: now,
      })
      .eq("id", user.id);

    if (updErr) {
      return json({ ok: false, error: updErr.message }, 500);
    }

    try {
      await admin.from("client_profiles").upsert(
        {
          user_id: user.id,
          phone: checked.phoneE164,
        },
        { onConflict: "user_id" },
      );
    } catch {
      // client_profiles row is optional for verification success
    }

    return json({
      ok: true,
      phone_e164: checked.phoneE164,
      phone_verified_at: now,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}
