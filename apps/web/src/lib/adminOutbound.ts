export type OutboundChannel = "push" | "sms" | "email";

export type SendPushInput = {
  userId: string;
  title: string;
  body: string;
  role?: "client" | "driver" | "restaurant";
};

export type SendSmsInput = {
  to: string;
  body: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
};

function getPushApiKey(): string {
  return String(process.env.PUSH_API_KEY ?? "").trim();
}

function getTwilioCreds(): { sid: string; token: string; from: string } | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from =
    String(process.env.TWILIO_SMS_FROM ?? process.env.TWILIO_PHONE_NUMBER ?? "").trim();

  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export async function sendAdminPush(
  input: SendPushInput
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  const apiKey = getPushApiKey();
  if (!apiKey) {
    return { ok: false, response: { error: "PUSH_API_KEY not configured" } };
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "http://localhost:3000";

  const base = origin.startsWith("http") ? origin : `https://${origin}`;

  const res = await fetch(`${base}/api/push/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      user_id: input.userId,
      title: input.title,
      body: input.body,
      role: input.role,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok && data.ok === true, response: data };
}

export async function sendAdminSms(
  input: SendSmsInput
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  const creds = getTwilioCreds();
  if (!creds) {
    return { ok: false, response: { error: "Twilio SMS not configured" } };
  }

  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: input.to,
      From: creds.from,
      Body: input.body,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, response: data };
}

export async function sendAdminEmail(
  input: SendEmailInput
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.ADMIN_EMAIL_FROM ?? "").trim();

  if (!apiKey || !from) {
    return {
      ok: false,
      response: { error: "RESEND_API_KEY or ADMIN_EMAIL_FROM not configured" },
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.body,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, response: data };
}
