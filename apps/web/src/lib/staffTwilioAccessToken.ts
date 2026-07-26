/**
 * Server-only Twilio Video Access Token minting.
 * Ready when TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET are set.
 * Never expose TWILIO_API_KEY_SECRET or AUTH_TOKEN to the browser.
 */

import twilio from "twilio";

const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

export type MintVideoTokenResult =
  | {
      ok: true;
      token: string;
      identity: string;
      roomName: string;
      ttlSeconds: number;
      expiresAt: string;
      refreshAfterSeconds: number;
    }
  | { ok: false; error: string; status: number };

/** Default token lifetime (1h). Clients should refresh before expiry. */
export const STAFF_VIDEO_TOKEN_TTL_SECONDS = 60 * 60;
export const STAFF_VIDEO_TOKEN_MAX_TTL_SECONDS = 60 * 60 * 4;
/** Refresh when 10 minutes remain (or 20% of TTL, whichever is smaller). */
export const STAFF_VIDEO_TOKEN_REFRESH_BUFFER_SECONDS = 10 * 60;

export function hasTwilioVideoApiKeys(): boolean {
  return (
    Boolean(String(process.env.TWILIO_ACCOUNT_SID ?? "").trim()) &&
    Boolean(String(process.env.TWILIO_API_KEY_SID ?? "").trim()) &&
    Boolean(String(process.env.TWILIO_API_KEY_SECRET ?? "").trim())
  );
}

/** Stable, URL-safe identity for a staff admin (never leaks secrets). */
export function buildStaffVideoIdentity(userId: string): string {
  const clean = String(userId ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  return `staff_${clean || "unknown"}`;
}

export function mintStaffVideoAccessToken(input: {
  identity: string;
  roomName: string;
  ttlSeconds?: number;
}): MintVideoTokenResult {
  if (!hasTwilioVideoApiKeys()) {
    return {
      ok: false,
      error:
        "TWILIO_ACCOUNT_SID + TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET required",
      status: 503,
    };
  }

  const accountSid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const apiKeySid = String(process.env.TWILIO_API_KEY_SID ?? "").trim();
  const apiKeySecret = String(process.env.TWILIO_API_KEY_SECRET ?? "").trim();

  const identity = String(input.identity ?? "")
    .trim()
    .slice(0, 120);
  const roomName = String(input.roomName ?? "")
    .trim()
    .slice(0, 120);
  if (!identity || !roomName) {
    return { ok: false, error: "identity and roomName required", status: 400 };
  }

  const ttl = Math.min(
    Math.max(Number(input.ttlSeconds) || STAFF_VIDEO_TOKEN_TTL_SECONDS, 60),
    STAFF_VIDEO_TOKEN_MAX_TTL_SECONDS
  );
  const refreshAfterSeconds = Math.max(
    60,
    ttl - Math.min(STAFF_VIDEO_TOKEN_REFRESH_BUFFER_SECONDS, Math.floor(ttl * 0.2))
  );

  try {
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl,
    });
    const grant = new VideoGrant({ room: roomName });
    token.addGrant(grant);
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return {
      ok: true,
      token: token.toJwt(),
      identity,
      roomName,
      ttlSeconds: ttl,
      expiresAt,
      refreshAfterSeconds,
    };
  } catch {
    return {
      ok: false,
      error: "Failed to mint Twilio Video access token",
      status: 500,
    };
  }
}

/** Secure status only — never returns key material. */
export function twilioVideoServerStatus(): "present" | "missing" | "invalid" {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const apiKeySid = String(process.env.TWILIO_API_KEY_SID ?? "").trim();
  const apiKeySecret = String(process.env.TWILIO_API_KEY_SECRET ?? "").trim();
  if (!accountSid && !apiKeySid && !apiKeySecret) return "missing";
  if (!accountSid || !apiKeySid || !apiKeySecret) return "missing";
  if (accountSid === "[SENSITIVE]" || apiKeySid === "[SENSITIVE]") return "invalid";
  if (!accountSid.startsWith("AC") || accountSid.length < 30) return "invalid";
  if (!apiKeySid.startsWith("SK") || apiKeySid.length < 30) return "invalid";
  if (apiKeySecret.length < 16) return "invalid";
  return "present";
}

/** Account SID + Auth Token for REST (SMS, Voice, Video Rooms) — status only. */
export function twilioRestServerStatus(): "present" | "missing" | "invalid" {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = String(
    process.env.TWILIO_AUTH_TOKEN ?? process.env.TWILIO_AUTH_TOKEN_SECRET ?? ""
  ).trim();
  if (!accountSid && !authToken) return "missing";
  if (!accountSid || !authToken) return "missing";
  if (accountSid === "[SENSITIVE]" || authToken === "[SENSITIVE]") return "invalid";
  if (!accountSid.startsWith("AC") || accountSid.length < 30) return "invalid";
  if (authToken.length < 16) return "invalid";
  return "present";
}
