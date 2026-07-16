import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.length !== bBytes.length) return false;

  return timingSafeEqual(aBytes, bBytes);
}

function getTwilioAuthToken(): string {
  return (
    process.env.TWILIO_AUTH_TOKEN?.trim() ||
    process.env.TWILIO_AUTH_TOKEN_SECRET?.trim() ||
    ""
  );
}

/** Public webhook URL as configured in Twilio Console (recommended in production). */
export function getTwilioWebhookUrl(
  req: NextRequest,
  pathname: string
): string {
  const override = process.env.TWILIO_WEBHOOK_BASE_URL?.trim();
  if (override) {
    return `${override.replace(/\/$/, "")}${pathname}`;
  }

  const proto = req.headers.get("x-forwarded-proto")?.trim() || "https";
  const host =
    req.headers.get("x-forwarded-host")?.trim() ||
    req.headers.get("host")?.trim() ||
    "";

  const search = req.nextUrl.search || "";
  return `${proto}://${host}${pathname}${search}`;
}

export function buildTwilioSignaturePayload(
  url: string,
  params: Record<string, string>
): string {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }
  return payload;
}

export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature) return false;

  const payload = buildTwilioSignaturePayload(url, params);
  const expected = createHmac("sha1", authToken)
    .update(payload, "utf8")
    .digest("base64");

  return timingSafeEqualStrings(signature, expected);
}

export async function formDataToParamRecord(
  formData: FormData
): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }
  return params;
}

export type TwilioWebhookAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export async function assertTwilioWebhookRequest(
  req: NextRequest,
  params: Record<string, string>
): Promise<TwilioWebhookAuthResult> {
  const authToken = getTwilioAuthToken();

  if (!authToken) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[twilio] TWILIO_AUTH_TOKEN missing — skipping signature check (non-production)"
      );
      return { ok: true };
    }

    console.error("[twilio] TWILIO_AUTH_TOKEN missing in production");
    return { ok: false, status: 500, message: "Twilio webhook misconfigured" };
  }

  const signature = req.headers.get("x-twilio-signature")?.trim() ?? "";

  if (!signature) {
    return { ok: false, status: 403, message: "Missing X-Twilio-Signature" };
  }

  const url = getTwilioWebhookUrl(req, req.nextUrl.pathname);

  if (!validateTwilioSignature(authToken, signature, url, params)) {
    console.error("[twilio] invalid signature", {
      path: req.nextUrl.pathname,
      url,
    });
    return { ok: false, status: 403, message: "Invalid Twilio signature" };
  }

  return { ok: true };
}
