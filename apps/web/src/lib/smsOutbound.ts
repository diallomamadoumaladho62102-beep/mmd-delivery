import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/apiRateLimit";
import { canSendUsA2pSms } from "@/lib/smsA2p";
import {
  hasActiveSmsConsent,
  hashPhoneE164,
  isPhoneOptedOut,
  phoneLast4,
} from "@/lib/smsConsent";
import { sendTwilioMessagingSms } from "@/lib/twilioMessagingSend";
import { normalizePhoneE164 } from "@/lib/phoneE164";

export type SmsMessageType =
  | "order_dispatched"
  | "order_delivered"
  | "package_dispatched"
  | "taxi_dispatched"
  | "support"
  | "opt_in_confirm"
  | "admin";

export type SendProgramSmsInput = {
  supabase: SupabaseClient;
  to: string;
  body: string;
  messageType: SmsMessageType;
  userId?: string | null;
  idempotencyKey?: string;
};

export type SendProgramSmsResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  twilioSid?: string;
};

const MARKETING_TYPES = new Set<string>(["marketing", "promo", "promotion"]);

export function isMarketingSmsType(messageType: string): boolean {
  return MARKETING_TYPES.has(messageType.trim().toLowerCase());
}

async function findExistingIdempotentSend(
  supabase: SupabaseClient,
  idempotencyKey: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("sms_message_logs")
    .select("twilio_message_sid")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return typeof data?.twilio_message_sid === "string"
    ? data.twilio_message_sid
    : null;
}

async function insertSmsLog(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("sms_message_logs").insert(row);
  if (error) {
    console.log("[sms] log insert failed:", error.message);
  }
}

export async function sendProgramSms(
  input: SendProgramSmsInput,
): Promise<SendProgramSmsResult> {
  if (isMarketingSmsType(input.messageType)) {
    return { ok: false, skipped: true, reason: "marketing_blocked" };
  }

  const to = normalizePhoneE164(input.to);
  const body = String(input.body ?? "").trim();
  if (!to || !body) {
    return { ok: false, skipped: true, reason: "invalid_destination_or_body" };
  }

  const a2p = canSendUsA2pSms();
  if (a2p.ok === false) {
    return { ok: false, skipped: true, reason: a2p.reason };
  }

  if (await isPhoneOptedOut(input.supabase, to)) {
    return { ok: false, skipped: true, reason: "opted_out" };
  }

  if (!(await hasActiveSmsConsent(input.supabase, to))) {
    return { ok: false, skipped: true, reason: "no_consent" };
  }

  const flood = checkRateLimit({
    namespace: "sms-program-send",
    key: to,
    limit: 8,
    windowMs: 60 * 60 * 1000,
  });
  if (flood.limited) {
    return { ok: false, skipped: true, reason: "rate_limited" };
  }

  if (input.idempotencyKey) {
    const existing = await findExistingIdempotentSend(
      input.supabase,
      input.idempotencyKey,
    );
    if (existing) {
      return {
        ok: true,
        skipped: true,
        reason: "idempotent_replay",
        twilioSid: existing,
      };
    }
  }

  const sent = await sendTwilioMessagingSms({ to, body });
  const now = new Date().toISOString();

  await insertSmsLog(input.supabase, {
    message_type: input.messageType,
    user_id: input.userId ?? null,
    phone_e164_hash: hashPhoneE164(to),
    phone_last4: phoneLast4(to),
    twilio_message_sid: sent.sid ?? null,
    status: sent.ok ? sent.status ?? "queued" : "failed",
    sent_at: sent.ok ? now : null,
    failed_at: sent.ok ? null : now,
    failure_reason: sent.ok ? null : sent.error ?? "send_failed",
    opt_in_status: true,
    idempotency_key: input.idempotencyKey ?? null,
  });

  return {
    ok: sent.ok,
    skipped: false,
    reason: sent.ok ? undefined : sent.error,
    twilioSid: sent.sid,
  };
}
