import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildTwilioSignaturePayload,
  getTwilioWebhookUrl,
  validateTwilioSignature,
} from "./twilioRequestValidation";
import {
  getTwilioVoiceIncomingUrl,
  getTwilioVoiceStatusCallbackUrl,
  TWILIO_PRODUCTION_BASE_URL,
} from "./twilioProductionUrls";

const AUTH_TOKEN = "test_twilio_auth_token_32chars!!";

function sign(url: string, params: Record<string, string>, token = AUTH_TOKEN) {
  const payload = buildTwilioSignaturePayload(url, params);
  return createHmac("sha1", token).update(payload, "utf8").digest("base64");
}

test("validateTwilioSignature accepts valid production URL signature", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/incoming`;
  const params = {
    CallSid: "CA123",
    From: "+15551234567",
    To: "+15559876543",
    CallStatus: "ringing",
  };

  const signature = sign(url, params);
  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, params), true);
});

test("validateTwilioSignature rejects invalid signature", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/status`;
  const params = { CallSid: "CA123", CallStatus: "completed" };

  assert.equal(
    validateTwilioSignature(AUTH_TOKEN, "invalid-signature", url, params),
    false,
  );
});

test("validateTwilioSignature rejects modified body (replay tamper)", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/status`;
  const original = { CallSid: "CA123", CallStatus: "completed" };
  const tampered = { CallSid: "CA123", CallStatus: "failed" };
  const signature = sign(url, original);

  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, tampered), false);
});

test("validateTwilioSignature rejects preview host URL mismatch", () => {
  const productionUrl = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/incoming`;
  const previewUrl = "https://mmd-delivery-git-main.vercel.app/api/twilio/voice/incoming";
  const params = { CallSid: "CA999", From: "+15550001111" };
  const signature = sign(productionUrl, params);

  assert.equal(
    validateTwilioSignature(AUTH_TOKEN, signature, previewUrl, params),
    false,
  );
});

test("validateTwilioSignature sorts params deterministically", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/incoming`;
  const paramsA = { Z: "1", A: "2", M: "3" };
  const paramsB = { A: "2", M: "3", Z: "1" };
  const signature = sign(url, paramsA);

  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, paramsB), true);
});

test("duplicate webhook payload keeps same valid signature", () => {
  const url = getTwilioVoiceStatusCallbackUrl();
  const params = {
    CallSid: "CA555",
    DialCallStatus: "no-answer",
    CallStatus: "completed",
  };
  const signature = sign(url, params);

  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, params), true);
  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, params), true);
});

test("getTwilioWebhookUrl prefers TWILIO_WEBHOOK_BASE_URL override", () => {
  const previous = process.env.TWILIO_WEBHOOK_BASE_URL;
  process.env.TWILIO_WEBHOOK_BASE_URL = "https://www.mmddelivery.com";
  try {
    const req = {
      headers: new Headers({
        host: "preview.vercel.app",
        "x-forwarded-proto": "https",
      }),
      nextUrl: { pathname: "/api/twilio/voice/incoming", search: "" },
    } as Parameters<typeof getTwilioWebhookUrl>[0];

    assert.equal(
      getTwilioWebhookUrl(req, "/api/twilio/voice/incoming"),
      "https://www.mmddelivery.com/api/twilio/voice/incoming",
    );
  } finally {
    if (previous === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
    else process.env.TWILIO_WEBHOOK_BASE_URL = previous;
  }
});

test("canonical production webhook URLs use mmddelivery.com", () => {
  const previousBase = process.env.TWILIO_WEBHOOK_BASE_URL;
  const previousIncoming = process.env.TWILIO_VOICE_INCOMING_URL;
  const previousStatus = process.env.TWILIO_VOICE_STATUS_CALLBACK_URL;

  delete process.env.TWILIO_WEBHOOK_BASE_URL;
  delete process.env.TWILIO_VOICE_INCOMING_URL;
  delete process.env.TWILIO_VOICE_STATUS_CALLBACK_URL;

  try {
    assert.equal(
      getTwilioVoiceIncomingUrl(),
      "https://www.mmddelivery.com/api/twilio/voice/incoming",
    );
    assert.equal(
      getTwilioVoiceStatusCallbackUrl(),
      "https://www.mmddelivery.com/api/twilio/voice/status",
    );
  } finally {
    if (previousBase === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
    else process.env.TWILIO_WEBHOOK_BASE_URL = previousBase;
    if (previousIncoming === undefined) delete process.env.TWILIO_VOICE_INCOMING_URL;
    else process.env.TWILIO_VOICE_INCOMING_URL = previousIncoming;
    if (previousStatus === undefined) delete process.env.TWILIO_VOICE_STATUS_CALLBACK_URL;
    else process.env.TWILIO_VOICE_STATUS_CALLBACK_URL = previousStatus;
  }
});
