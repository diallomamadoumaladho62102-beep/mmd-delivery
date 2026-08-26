/** Existing Low Volume Mixed A2P Messaging Service — do not create another. */
export const MMD_A2P_MESSAGING_SERVICE_SID =
  "MG8ef96bdce31bc5b2a8e21c3ebcbd4f12";

export const MMD_SMS_PROGRAM_NAME = "MMD Delivery";
export const MMD_SMS_CTA_PATH = "/legal/sms";
export const MMD_SMS_CTA_URL = "https://www.mmddelivery.com/legal/sms";
export const MMD_SMS_PRIVACY_URL = "https://www.mmddelivery.com/legal/privacy";
export const MMD_SMS_TERMS_URL = "https://www.mmddelivery.com/legal/terms";
export const MMD_SMS_SUPPORT_URL = "https://www.mmddelivery.com/legal/support";
export const MMD_SMS_SUPPORT_EMAIL = "support@mmddelivery.com";
export const MMD_SMS_SUPPORT_PHONE_DISPLAY = "+1 (929) 492-4563";
export const MMD_SMS_LEGAL_VERSION = "2026-08-26";

function truthyEnv(name: string): boolean {
  return ["true", "1", "yes"].includes(
    String(process.env[name] ?? "").trim().toLowerCase(),
  );
}

export function isSmsA2pApproved(): boolean {
  return truthyEnv("SMS_A2P_10DLC_US_DONE");
}

export function isTransactionalSmsEnabled(): boolean {
  return truthyEnv("TRANSACTIONAL_SMS_ENABLED");
}

export function getTwilioMessagingServiceSid(): string | null {
  const fromEnv = String(process.env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();
  if (fromEnv) return fromEnv;
  return MMD_A2P_MESSAGING_SERVICE_SID;
}

export function isMessagingServiceConfigured(): boolean {
  return Boolean(getTwilioMessagingServiceSid());
}

/**
 * US A2P traffic may leave our servers only after the campaign is approved
 * and transactional sending is explicitly enabled. Defaults are off.
 */
export function canSendUsA2pSms(): { ok: true } | { ok: false; reason: string } {
  if (!isTransactionalSmsEnabled()) {
    return { ok: false, reason: "transactional_sms_disabled" };
  }
  if (!isSmsA2pApproved()) {
    return { ok: false, reason: "a2p_not_approved" };
  }
  if (!getTwilioMessagingServiceSid()) {
    return { ok: false, reason: "messaging_service_missing" };
  }
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!sid || !token) {
    return { ok: false, reason: "twilio_creds_missing" };
  }
  return { ok: true };
}
