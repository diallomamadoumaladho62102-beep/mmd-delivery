import { getTwilioMessagingServiceSid } from "@/lib/smsA2p";
import { getTwilioSmsStatusCallbackUrl } from "@/lib/twilioProductionUrls";

export type TwilioMessagingSendInput = {
  to: string;
  body: string;
};

export type TwilioMessagingSendResult = {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
  response: Record<string, unknown>;
  messagingServiceSid: string | null;
};

function getTwilioAccountCreds(): { sid: string; token: string } | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!sid || !token) return null;
  return { sid, token };
}

/** Low-level A2P send: Messaging Service only. Never sets Voice From. */
export async function sendTwilioMessagingSms(
  input: TwilioMessagingSendInput,
): Promise<TwilioMessagingSendResult> {
  const creds = getTwilioAccountCreds();
  const messagingServiceSid = getTwilioMessagingServiceSid();
  if (!creds || !messagingServiceSid) {
    return {
      ok: false,
      error: "Twilio Messaging Service not configured",
      response: { error: "Twilio Messaging Service not configured" },
      messagingServiceSid,
    };
  }

  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`;
  const params = new URLSearchParams({
    To: input.to,
    MessagingServiceSid: messagingServiceSid,
    Body: input.body,
  });

  const statusCallback = getTwilioSmsStatusCallbackUrl();
  if (statusCallback) {
    params.set("StatusCallback", statusCallback);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: res.ok,
    sid: typeof data.sid === "string" ? data.sid : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    error: res.ok
      ? undefined
      : String(data.message ?? data.error ?? "twilio_sms_failed"),
    response: data,
    messagingServiceSid,
  };
}
