import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getRequestClientIp } from "@/lib/apiRateLimit";
import { resolveRequestUser } from "@/lib/requestUser";
import {
  assertExplicitConsentChecked,
  loadSmsConsentState,
  recordSmsConsent,
  type SmsConsentSource,
} from "@/lib/smsConsent";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function loadUserPhone(
  userId: string,
  requested?: string,
): Promise<string | null> {
  const supabase = buildSupabaseAdminClient();
  if (requested?.trim()) return requested.trim();
  const { data } = await supabase
    .from("profiles")
    .select("phone, phone_e164")
    .eq("id", userId)
    .maybeSingle();
  return String(data?.phone_e164 ?? data?.phone ?? "").trim() || null;
}

export async function GET(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  const phone = await loadUserPhone(user.id);
  if (!phone) {
    return json({ ok: true, sms_consent: false, opted_out: false, has_phone: false });
  }

  const state = await loadSmsConsentState(buildSupabaseAdminClient(), phone);
  if ("error" in state) {
    return json({ ok: true, sms_consent: false, opted_out: false, has_phone: true });
  }

  return json({
    ok: true,
    sms_consent: state.smsConsent,
    opted_out: state.optedOut,
    has_phone: true,
  });
}

export async function POST(request: NextRequest) {
  const user = await resolveRequestUser(request);
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  const rate = checkRateLimit({
    namespace: "sms-auth-consent",
    key: user.id,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (rate.limited) {
    return json({ ok: false, error: "Too many attempts. Try again later." }, 429);
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    consent?: unknown;
    source?: string;
  };

  const consented = assertExplicitConsentChecked(body.consent);
  if (body.consent !== true && body.consent !== false) {
    return json({ ok: false, error: "consent must be true or false" }, 400);
  }

  const phone = await loadUserPhone(user.id, body.phone);
  if (!phone) {
    return json({ ok: false, error: "Add a phone number first." }, 400);
  }

  const source: SmsConsentSource =
    body.source === "web_signup" ||
    body.source === "mobile_signup" ||
    body.source === "mobile_profile"
      ? body.source
      : "web_profile";

  const recorded = await recordSmsConsent(buildSupabaseAdminClient(), {
    phone,
    consented,
    source,
    userId: user.id,
    ipAddress: getRequestClientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  });

  if (recorded.ok === false) {
    return json({ ok: false, error: recorded.error }, 400);
  }

  return json({ ok: true, sms_consent: consented, phone_saved: true });
}
