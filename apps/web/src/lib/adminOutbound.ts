import { createClient } from "@supabase/supabase-js";
import { MMD_PUSH_SOUNDS } from "@/lib/mmdPushSounds";

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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function getTwilioCreds(): { sid: string; token: string; from: string } | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  const from =
    String(process.env.TWILIO_SMS_FROM ?? process.env.TWILIO_PHONE_NUMBER ?? "").trim();

  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

function getSupabaseAdminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing Supabase admin env");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function isExpoPushToken(token: unknown): token is string {
  const s = String(token ?? "").trim();
  return (
    /^ExponentPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s) ||
    /^ExpoPushToken\[[A-Za-z0-9+\-_=:/]+\]$/.test(s)
  );
}

/** Staff-initiated push — uses admin RBAC upstream; does not call /api/push/send. */
export async function sendAdminPush(
  input: SendPushInput,
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  try {
    const supabase = getSupabaseAdminClient();
    let query = supabase
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", input.userId);

    if (input.role) {
      query = query.eq("role", input.role);
    }

    const { data: rows, error } = await query.limit(50);
    if (error) {
      return { ok: false, response: { error: error.message } };
    }

    const tokens = [...new Set(
      ((rows ?? []) as { expo_push_token?: string | null }[])
        .map((row) => String(row.expo_push_token ?? "").trim())
        .filter(isExpoPushToken),
    )];

    if (tokens.length === 0) {
      return { ok: false, response: { ok: true, reason: "no_tokens", sent: 0 } };
    }

    const messages = tokens.map((to) => ({
      to,
      sound: MMD_PUSH_SOUNDS.system,
      title: input.title,
      body: input.body,
      data: { source: "admin_communication" },
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const delivered = res.ok && tokens.length > 0;
    return {
      ok: delivered,
      response: {
        ok: res.ok,
        sent: tokens.length,
        provider: data,
      },
    };
  } catch (e: unknown) {
    return {
      ok: false,
      response: {
        error: e instanceof Error ? e.message : "admin_push_failed",
      },
    };
  }
}

export async function sendAdminSms(
  input: SendSmsInput,
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  const creds = getTwilioCreds();
  if (!creds) {
    return { ok: false, response: { error: "Twilio SMS not configured" } };
  }

  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`;

  const body = new URLSearchParams({
    To: input.to,
    From: creds.from,
    Body: input.body,
  });

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
  return { ok: res.ok, response: data };
}

export async function sendAdminEmail(
  input: SendEmailInput,
): Promise<{ ok: boolean; response: Record<string, unknown> }> {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const from = String(process.env.ADMIN_EMAIL_FROM ?? "").trim();

  if (!apiKey || !from) {
    return { ok: false, response: { error: "Resend email not configured" } };
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
