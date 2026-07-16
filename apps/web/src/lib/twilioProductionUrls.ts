/** Canonical production host for Twilio webhooks (no trailing slash). */
export const TWILIO_PRODUCTION_BASE_URL = "https://www.mmddelivery.com";

export const TWILIO_VOICE_INCOMING_PATH = "/api/twilio/voice/incoming";
export const TWILIO_VOICE_STATUS_PATH = "/api/twilio/voice/status";
export const TWILIO_SMS_INCOMING_PATH = "/api/twilio/sms";

export function getTwilioProductionBaseUrl(): string {
  const override = String(process.env.TWILIO_WEBHOOK_BASE_URL ?? "").trim();
  if (override) return override.replace(/\/$/, "");
  return TWILIO_PRODUCTION_BASE_URL;
}

export function getTwilioVoiceIncomingUrl(): string {
  const override = String(process.env.TWILIO_VOICE_INCOMING_URL ?? "").trim();
  if (override) return override;
  return `${getTwilioProductionBaseUrl()}${TWILIO_VOICE_INCOMING_PATH}`;
}

export function getTwilioVoiceStatusCallbackUrl(): string {
  const override = String(
    process.env.TWILIO_VOICE_STATUS_CALLBACK_URL ?? "",
  ).trim();
  if (override) return override;
  return `${getTwilioProductionBaseUrl()}${TWILIO_VOICE_STATUS_PATH}`;
}

export function getTwilioSmsIncomingUrl(): string {
  const override = String(process.env.TWILIO_SMS_INCOMING_URL ?? "").trim();
  if (override) return override;
  return `${getTwilioProductionBaseUrl()}${TWILIO_SMS_INCOMING_PATH}`;
}
