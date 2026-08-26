import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneE164 } from "@/lib/phoneE164";
import { MMD_SMS_LEGAL_VERSION } from "@/lib/smsA2p";

export const SMS_CONSENT_TYPE = "transactional" as const;

export type SmsConsentSource =
  | "public_cta"
  | "web_signup"
  | "mobile_signup"
  | "web_profile"
  | "mobile_profile"
  | "inbound_start";

export type SmsConsentRecordInput = {
  phone: string;
  consented: boolean;
  source: SmsConsentSource;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  privacyVersion?: string;
  termsVersion?: string;
};

export type SmsConsentState = {
  phoneE164: string;
  smsConsent: boolean;
  optedOut: boolean;
  hadPriorExplicitConsent: boolean;
  source: string | null;
  consentTimestamp: string | null;
};

export function hashPhoneE164(phoneE164: string): string {
  return createHash("sha256").update(phoneE164).digest("hex");
}

export function phoneLast4(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return digits.slice(-4);
}

export function assertExplicitConsentChecked(checked: unknown): boolean {
  return checked === true;
}

export async function loadSmsConsentState(
  supabase: SupabaseClient,
  phone: string,
): Promise<SmsConsentState | { error: string }> {
  const phoneE164 = normalizePhoneE164(phone);
  if (!phoneE164) return { error: "invalid_phone" };

  const [{ data: consent }, { data: optOut }] = await Promise.all([
    supabase
      .from("sms_consents")
      .select(
        "sms_consent, consent_source, consent_timestamp, revoked_at, opt_out_timestamp",
      )
      .eq("phone_e164", phoneE164)
      .eq("consent_type", SMS_CONSENT_TYPE)
      .maybeSingle(),
    supabase
      .from("sms_opt_outs")
      .select("phone_e164")
      .eq("phone_e164", phoneE164)
      .maybeSingle(),
  ]);

  const row = consent as {
    sms_consent?: boolean;
    consent_source?: string | null;
    consent_timestamp?: string | null;
    revoked_at?: string | null;
    opt_out_timestamp?: string | null;
  } | null;

  const hadPriorExplicitConsent = Boolean(row?.consent_timestamp);
  const optedOut = Boolean(optOut?.phone_e164 || row?.opt_out_timestamp);
  const smsConsent = row?.sms_consent === true && !optedOut;

  return {
    phoneE164,
    smsConsent,
    optedOut,
    hadPriorExplicitConsent,
    source: row?.consent_source ?? null,
    consentTimestamp: row?.consent_timestamp ?? null,
  };
}

export async function isPhoneOptedOut(
  supabase: SupabaseClient,
  phone: string,
): Promise<boolean> {
  const state = await loadSmsConsentState(supabase, phone);
  if ("error" in state) return true;
  return state.optedOut;
}

export async function hasActiveSmsConsent(
  supabase: SupabaseClient,
  phone: string,
): Promise<boolean> {
  const state = await loadSmsConsentState(supabase, phone);
  if ("error" in state) return false;
  return state.smsConsent;
}

export async function recordSmsConsent(
  supabase: SupabaseClient,
  input: SmsConsentRecordInput,
): Promise<{ ok: true; phoneE164: string } | { ok: false; error: string }> {
  const phoneE164 = normalizePhoneE164(input.phone);
  if (!phoneE164) return { ok: false, error: "invalid_phone" };

  const now = new Date().toISOString();
  const privacyVersion = input.privacyVersion ?? MMD_SMS_LEGAL_VERSION;
  const termsVersion = input.termsVersion ?? MMD_SMS_LEGAL_VERSION;

  if (input.consented) {
    const { error } = await supabase.from("sms_consents").upsert(
      {
        phone_e164: phoneE164,
        user_id: input.userId ?? null,
        sms_consent: true,
        consent_type: SMS_CONSENT_TYPE,
        consent_source: input.source,
        consent_timestamp: now,
        privacy_version: privacyVersion,
        terms_version: termsVersion,
        ip_address: input.ipAddress || null,
        user_agent: input.userAgent || null,
        revoked_at: null,
        opt_out_timestamp: null,
        updated_at: now,
      },
      { onConflict: "phone_e164,consent_type" },
    );
    if (error) return { ok: false, error: error.message };

    await supabase.from("sms_opt_outs").delete().eq("phone_e164", phoneE164);
    return { ok: true, phoneE164 };
  }

  const { error } = await supabase.from("sms_consents").upsert(
    {
      phone_e164: phoneE164,
      user_id: input.userId ?? null,
      sms_consent: false,
      consent_type: SMS_CONSENT_TYPE,
      consent_source: input.source,
      privacy_version: privacyVersion,
      terms_version: termsVersion,
      ip_address: input.ipAddress || null,
      user_agent: input.userAgent || null,
      revoked_at: now,
      opt_out_timestamp: now,
      updated_at: now,
    },
    { onConflict: "phone_e164,consent_type" },
  );
  if (error) return { ok: false, error: error.message };

  await supabase.from("sms_opt_outs").upsert(
    {
      phone_e164: phoneE164,
      opted_out_at: now,
      source: input.source,
      keyword: null,
    },
    { onConflict: "phone_e164" },
  );

  return { ok: true, phoneE164 };
}

export async function applyInboundStop(
  supabase: SupabaseClient,
  phone: string,
  keyword: string,
): Promise<{ ok: true; phoneE164: string } | { ok: false; error: string }> {
  const phoneE164 = normalizePhoneE164(phone);
  if (!phoneE164) return { ok: false, error: "invalid_phone" };
  const now = new Date().toISOString();

  await supabase.from("sms_opt_outs").upsert(
    {
      phone_e164: phoneE164,
      opted_out_at: now,
      source: "inbound_stop",
      keyword,
    },
    { onConflict: "phone_e164" },
  );

  const { data: existing } = await supabase
    .from("sms_consents")
    .select("id")
    .eq("phone_e164", phoneE164)
    .eq("consent_type", SMS_CONSENT_TYPE)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("sms_consents")
      .update({
        sms_consent: false,
        revoked_at: now,
        opt_out_timestamp: now,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("sms_consents").insert({
      phone_e164: phoneE164,
      sms_consent: false,
      consent_type: SMS_CONSENT_TYPE,
      consent_source: "inbound_stop",
      revoked_at: now,
      opt_out_timestamp: now,
    });
  }

  return { ok: true, phoneE164 };
}

export async function applyInboundStart(
  supabase: SupabaseClient,
  phone: string,
): Promise<
  | { ok: true; phoneE164: string; restored: true }
  | { ok: true; phoneE164: string; restored: false }
  | { ok: false; error: string }
> {
  const state = await loadSmsConsentState(supabase, phone);
  if ("error" in state) return { ok: false, error: state.error };

  if (!state.hadPriorExplicitConsent) {
    return { ok: true, phoneE164: state.phoneE164, restored: false };
  }

  const recorded = await recordSmsConsent(supabase, {
    phone: state.phoneE164,
    consented: true,
    source: "inbound_start",
  });
  if (recorded.ok === false) return recorded;
  return { ok: true, phoneE164: recorded.phoneE164, restored: true };
}
