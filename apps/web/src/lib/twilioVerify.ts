import { normalizePhoneE164 } from "@/lib/phoneE164";

function truthyEnv(name: string): boolean {
  return ["true", "1", "yes"].includes(
    String(process.env[name] ?? "").trim().toLowerCase(),
  );
}

export function isPhoneOtpEnabled(): boolean {
  return truthyEnv("PHONE_OTP_ENABLED");
}

function getTwilioVerifyConfig(): {
  sid: string;
  token: string;
  serviceSid: string;
} | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const serviceSid = String(process.env.TWILIO_VERIFY_SERVICE_SID ?? "").trim();
  if (!sid || !token || !serviceSid) return null;
  return { sid, token, serviceSid };
}

export function isTwilioVerifyConfigured(): boolean {
  return getTwilioVerifyConfig() != null;
}

async function twilioVerifyFetch(
  path: string,
  body: URLSearchParams,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const creds = getTwilioVerifyConfig();
  if (!creds) {
    return {
      ok: false,
      status: 503,
      data: { error: "Phone verification is temporarily unavailable." },
    };
  }

  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
  const url = `https://verify.twilio.com/v2/Services/${creds.serviceSid}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function startPhoneVerification(params: {
  phone: string;
  channel?: "sms" | "call";
}): Promise<{ ok: boolean; error?: string; phoneE164?: string }> {
  if (!isPhoneOtpEnabled()) {
    return { ok: false, error: "Phone verification is temporarily unavailable." };
  }
  const phoneE164 = normalizePhoneE164(params.phone);
  if (!phoneE164) {
    return { ok: false, error: "Invalid phone number" };
  }

  const body = new URLSearchParams();
  body.set("To", phoneE164);
  body.set("Channel", params.channel ?? "sms");

  const result = await twilioVerifyFetch("Verifications", body);
  if (!result.ok) {
    return { ok: false, error: "Unable to send the verification code." };
  }
  return { ok: true, phoneE164 };
}

export async function checkPhoneVerification(params: {
  phone: string;
  code: string;
}): Promise<{ ok: boolean; error?: string; phoneE164?: string }> {
  if (!isPhoneOtpEnabled()) {
    return { ok: false, error: "Phone verification is temporarily unavailable." };
  }
  const phoneE164 = normalizePhoneE164(params.phone);
  const code = String(params.code ?? "").trim();
  if (!phoneE164) return { ok: false, error: "Invalid phone number" };
  if (!/^\d{4,10}$/.test(code)) {
    return { ok: false, error: "Invalid verification code" };
  }

  const body = new URLSearchParams();
  body.set("To", phoneE164);
  body.set("Code", code);

  const result = await twilioVerifyFetch("VerificationCheck", body);
  const status = String(result.data.status ?? "").toLowerCase();
  if (!result.ok || status !== "approved") {
    return { ok: false, error: "Invalid or expired verification code." };
  }
  return { ok: true, phoneE164 };
}
