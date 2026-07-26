import assert from "node:assert/strict";
import {
  buildStaffAttachmentPath,
  messageTypeForKind,
  validateStaffAttachmentMeta,
} from "./staffAttachmentSecurity";
import {
  hasTwilioVideoApiKeys,
  mintStaffVideoAccessToken,
  twilioVideoServerStatus,
} from "./staffTwilioAccessToken";
import {
  assertNoMapboxDownloadTokenInPublicEnv,
  getPublicMapboxToken,
} from "./mapboxToken";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("attachment meta rejects unknown mime", () => {
  const r = validateStaffAttachmentMeta({
    mime: "application/x-msdownload",
    size: 100,
    fileName: "evil.exe",
  });
  assert.equal(r.ok, false);
});

test("attachment meta accepts image and builds safe path", () => {
  const r = validateStaffAttachmentMeta({
    mime: "image/png",
    size: 1024,
    fileName: "../../weird name!!.PNG",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.kind, "image");
  assert.equal(messageTypeForKind(r.kind), "image");
  const path = buildStaffAttachmentPath({
    conversationId: "conv-1",
    uploaderId: "user-1",
    safeName: r.safeName,
  });
  assert.match(path, /^conv-1\/user-1\//);
  assert.doesNotMatch(path, /\.\./);
});

test("attachment size limit enforced", () => {
  const r = validateStaffAttachmentMeta({
    mime: "image/jpeg",
    size: 20 * 1024 * 1024,
    fileName: "big.jpg",
  });
  assert.equal(r.ok, false);
});

test("twilio video mint fails closed without keys", () => {
  const prev = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID: process.env.TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET: process.env.TWILIO_API_KEY_SECRET,
  };
  try {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_API_KEY_SID;
    delete process.env.TWILIO_API_KEY_SECRET;
    assert.equal(hasTwilioVideoApiKeys(), false);
    assert.equal(twilioVideoServerStatus(), "missing");
    const minted = mintStaffVideoAccessToken({
      identity: "staff_test",
      roomName: "room-test",
    });
    assert.equal(minted.ok, false);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("twilio video mint succeeds with shape-valid api keys (no network)", () => {
  const prev = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_API_KEY_SID: process.env.TWILIO_API_KEY_SID,
    TWILIO_API_KEY_SECRET: process.env.TWILIO_API_KEY_SECRET,
  };
  try {
    process.env.TWILIO_ACCOUNT_SID = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    process.env.TWILIO_API_KEY_SID = "SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    process.env.TWILIO_API_KEY_SECRET = "test_secret_value_16";
    assert.equal(hasTwilioVideoApiKeys(), true);
    assert.equal(twilioVideoServerStatus(), "present");
    const minted = mintStaffVideoAccessToken({
      identity: "staff_test_user",
      roomName: "mmd-staff-room",
    });
    assert.equal(minted.ok, true);
    if (minted.ok) {
      assert.ok(minted.token.length > 20);
      assert.ok(minted.expiresAt);
      assert.ok(minted.refreshAfterSeconds > 0);
      assert.doesNotMatch(minted.token, /TWILIO_API_KEY_SECRET/);
    }
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("public mapbox rejects secret sk tokens", () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NEXT_PUBLIC_MAPBOX_TOKEN;
  try {
    env.NEXT_PUBLIC_MAPBOX_TOKEN = "sk.secret-should-not-be-public";
    assert.equal(getPublicMapboxToken(), null);
    assert.equal(assertNoMapboxDownloadTokenInPublicEnv(), false);
  } finally {
    if (prev == null) delete env.NEXT_PUBLIC_MAPBOX_TOKEN;
    else env.NEXT_PUBLIC_MAPBOX_TOKEN = prev;
  }
});

console.log("staffIntegrationsSecurity tests passed");
