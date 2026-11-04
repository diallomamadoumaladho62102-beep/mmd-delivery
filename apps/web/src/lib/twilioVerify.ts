import { normalizePhoneE164 } from "@/lib/phoneE164";

function truthyEnv(name: string): boolean {
  return ["true", "1", "yes"].includes(
    String(process.env[name] ?? "").trim().toLowerCase(),
  );
}

export function isPhoneOtpEnabled(): boolean {
  return truthyEnv("PHONE_OTP_ENABLED");
}

/** True on Vercel production or NODE_ENV=production (local prod builds). */
export function isPhoneOtpProductionRuntime(): boolean {
  return (
    String(process.env.VERCEL_ENV ?? "").trim() === "production" ||
    String(process.env.NODE_ENV ?? "").trim() === "production"
  );
}

/**
 * Lab-only OTP path: never calls Twilio / never sends SMS.
 * Requires PHONE_OTP_ENABLED + PHONE_OTP_SIMULATE.
 * Hard-disabled in production runtimes even if the env flag is set.
 * Only accepts isolated test numbers (US +1555… / GN +22462… audit ranges).
 */
export function isPhoneOtpSimulate(): boolean {
  if (isPhoneOtpProductionRuntime()) return false;
  return isPhoneOtpEnabled() && truthyEnv("PHONE_OTP_SIMULATE");
}

/** Fixed lab code for simulate mode (never used with real Twilio). */
export const PHONE_OTP_SIMULATE_CODE = "246810";

const simulateLedger = new Map<
  string,
  { startedAt: number; attempts: number; consumed: boolean }
>();

export function isIsolatedOtpTestPhone(phoneE164: string): boolean {
  // US lab NANP 555 exchange + Guinea audit prefixes used by mmd-reg-audit probes.
  return (
    /^\+1555\d{7}$/.test(phoneE164) ||
    /^\+22462\d{6,8}$/.test(phoneE164)
  );
}

export function resetPhoneOtpSimulateLedgerForTests(): void {
  simulateLedger.clear();
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
  return getTwilioVerifyConfig() != null || isPhoneOtpSimulate();
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
}): Promise<{ ok: boolean; error?: string; phoneE164?: string; simulated?: boolean }> {
  if (!isPhoneOtpEnabled()) {
    return { ok: false, error: "Phone verification is temporarily unavailable." };
  }
  const phoneE164 = normalizePhoneE164(params.phone);
  if (!phoneE164) {
    return { ok: false, error: "Invalid phone number" };
  }

  if (isPhoneOtpSimulate()) {
    if (!isIsolatedOtpTestPhone(phoneE164)) {
      return {
        ok: false,
        error: "Simulate mode only accepts isolated lab phone numbers.",
      };
    }
    simulateLedger.set(phoneE164, {
      startedAt: Date.now(),
      attempts: 0,
      consumed: false,
    });
    return { ok: true, phoneE164, simulated: true };
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
}): Promise<{ ok: boolean; error?: string; phoneE164?: string; simulated?: boolean }> {
  if (!isPhoneOtpEnabled()) {
    return { ok: false, error: "Phone verification is temporarily unavailable." };
  }
  const phoneE164 = normalizePhoneE164(params.phone);
  const code = String(params.code ?? "").trim();
  if (!phoneE164) return { ok: false, error: "Invalid phone number" };
  if (!/^\d{4,10}$/.test(code)) {
    return { ok: false, error: "Invalid verification code" };
  }

  if (isPhoneOtpSimulate()) {
    if (!isIsolatedOtpTestPhone(phoneE164)) {
      return {
        ok: false,
        error: "Simulate mode only accepts isolated lab phone numbers.",
      };
    }
    const row = simulateLedger.get(phoneE164);
    if (!row) {
      return { ok: false, error: "Invalid or expired verification code." };
    }
    row.attempts += 1;
    if (row.consumed) {
      return { ok: false, error: "Invalid or expired verification code." };
    }
    // Lab "expired": special code or >10 minutes.
    if (code === "000000" || Date.now() - row.startedAt > 10 * 60_000) {
      return { ok: false, error: "Invalid or expired verification code." };
    }
    if (row.attempts > 5) {
      return { ok: false, error: "Too many attempts. Try again later." };
    }
    if (code !== PHONE_OTP_SIMULATE_CODE) {
      return { ok: false, error: "Invalid or expired verification code." };
    }
    row.consumed = true;
    return { ok: true, phoneE164, simulated: true };
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
