const FALLBACK_TWILIO_NUMBER = "+19294924563";

/** Canonical Twilio caller ID for masked proxy calls (env-first). */
export function getTwilioPhoneNumber(): string {
  const fromEnv = String(
    process.env.TWILIO_PHONE_NUMBER ??
      process.env.MMD_TWILIO_PHONE_NUMBER ??
      "",
  ).trim();

  return fromEnv || FALLBACK_TWILIO_NUMBER;
}
