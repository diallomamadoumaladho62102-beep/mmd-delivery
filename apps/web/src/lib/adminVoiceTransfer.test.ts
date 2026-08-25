import assert from "node:assert/strict";
import test from "node:test";

import {
  actorCanTransferAdminVoice,
  assertEligibleAdminVoiceDestination,
  buildAdminDialTwiml,
  buildInboundAdminVoiceCallRow,
  executeAdminVoiceTransfer,
  mapTwilioStatusToAdminVoice,
  parseTransferRequest,
  redactAdminVoiceLog,
  resolveIncomingVoiceRoute,
  type AdminVoiceCallRow,
  type AdminVoiceDestinationProfile,
} from "./adminVoiceTransfer";
import { getTwilioPhoneNumber } from "./twilioPhone";
import { validateTwilioSignature } from "./twilioRequestValidation";
import { createHmac } from "node:crypto";
import { TWILIO_PRODUCTION_BASE_URL } from "./twilioProductionUrls";

const AUTH_TOKEN = "test_twilio_auth_token_32chars!!";
const PUBLIC_NUMBER = "+19294924563";
const ADMIN_A_PHONE = "+19297408722";
const ADMIN_B_PHONE = "+15551230001";
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_A_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_B_ID = "33333333-3333-4333-8333-333333333333";
const FINANCE_ID = "44444444-4444-4444-8444-444444444444";

function sign(url: string, params: Record<string, string>, token = AUTH_TOKEN) {
  const keys = Object.keys(params).sort();
  let payload = url;
  for (const key of keys) payload += key + params[key];
  return createHmac("sha1", token).update(payload, "utf8").digest("base64");
}

function activeCall(overrides: Partial<AdminVoiceCallRow> = {}): AdminVoiceCallRow {
  return {
    id: CALL_ID,
    parent_call_sid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    from_phone: "+15559876543",
    current_admin_user_id: ADMIN_A_ID,
    current_admin_phone: ADMIN_A_PHONE,
    status: "in_progress",
    created_at: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function adminProfile(
  overrides: Partial<AdminVoiceDestinationProfile> = {},
): AdminVoiceDestinationProfile {
  return {
    id: ADMIN_B_ID,
    full_name: "Admin B",
    role: "support_admin",
    is_founder: false,
    phone: ADMIN_B_PHONE,
    account_status: "active",
    ...overrides,
  };
}

test("authorized support admin can initiate a transfer", () => {
  assert.equal(
    actorCanTransferAdminVoice({
      userId: ADMIN_A_ID,
      role: "support_admin",
      isFounder: false,
    }),
    true,
  );
  assert.equal(
    actorCanTransferAdminVoice({
      userId: ADMIN_A_ID,
      role: "operations_admin",
      isFounder: false,
    }),
    true,
  );
});

test("unauthorized user cannot transfer", () => {
  assert.equal(
    actorCanTransferAdminVoice({
      userId: FINANCE_ID,
      role: "finance_admin",
      isFounder: false,
    }),
    false,
  );
  assert.equal(
    actorCanTransferAdminVoice({
      userId: "client-1",
      role: "client",
      isFounder: false,
    }),
    false,
  );
});

test("unauthorized destination is refused", () => {
  const refused = assertEligibleAdminVoiceDestination(
    adminProfile({
      id: FINANCE_ID,
      role: "finance_admin",
      phone: "+15550001111",
    }),
  );
  assert.equal(refused.ok, false);
  if (refused.ok === false) {
    assert.equal(refused.status, 403);
  }

  const review = assertEligibleAdminVoiceDestination(
    adminProfile({ role: "review_admin", phone: "+15550002222" }),
  );
  assert.equal(review.ok, false);
});

test("call without a valid session is refused", async () => {
  const result = await executeAdminVoiceTransfer({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    destinationUserId: ADMIN_B_ID,
    deps: {
      loadCall: async () => null,
      loadDestination: async () => adminProfile(),
      updateCall: async () => {
        throw new Error("should not update missing call");
      },
      redirectCall: async () => {
        throw new Error("should not call Twilio for missing call");
      },
    },
  });

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 404);
  }
});

test("completed call session cannot be transferred", async () => {
  const result = await executeAdminVoiceTransfer({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    destinationUserId: ADMIN_B_ID,
    deps: {
      loadCall: async () => activeCall({ status: "completed" }),
      loadDestination: async () => adminProfile(),
      updateCall: async () => {
        throw new Error("should not update completed call");
      },
      redirectCall: async () => {
        throw new Error("should not call Twilio for completed call");
      },
    },
  });

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 409);
  }
});

test("Twilio Voice webhook signature remains valid", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/incoming`;
  const params = {
    CallSid: "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    From: "+15551234567",
    To: PUBLIC_NUMBER,
    CallStatus: "ringing",
  };
  const signature = sign(url, params);
  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, params), true);
  assert.equal(
    validateTwilioSignature(AUTH_TOKEN, "tampered", url, params),
    false,
  );
});

test("transfer to an available authorized admin works with mocked Twilio", async () => {
  const previous = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_PHONE_NUMBER = PUBLIC_NUMBER;

  let updated: Record<string, unknown> | null = null;
  let redirectedTwiml = "";
  let redirectedSid = "";

  try {
    const result = await executeAdminVoiceTransfer({
      actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
      callId: CALL_ID,
      destinationUserId: ADMIN_B_ID,
      deps: {
        loadCall: async () => activeCall(),
        loadDestination: async () => adminProfile(),
        updateCall: async (_id, patch) => {
          updated = patch;
        },
        redirectCall: async ({ callSid, twiml }) => {
          redirectedSid = callSid;
          redirectedTwiml = twiml;
          return { ok: true, status: 200 };
        },
      },
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.destinationUserId, ADMIN_B_ID);
    }
    assert.equal(redirectedSid, "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert.match(redirectedTwiml, new RegExp(ADMIN_B_PHONE.replace("+", "\\+")));
    assert.match(redirectedTwiml, /callerId="\+19294924563"/);
    assert.equal(updated?.status, "transferred");
    assert.equal(updated?.current_admin_user_id, ADMIN_B_ID);
    assert.equal(updated?.current_admin_phone, ADMIN_B_PHONE);
    assert.doesNotMatch(JSON.stringify(result), /TWILIO_AUTH_TOKEN|authToken|Basic /);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = previous;
  }
});

test("transfer to an unauthorized destination never calls Twilio", async () => {
  const result = await executeAdminVoiceTransfer({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    destinationUserId: FINANCE_ID,
    deps: {
      loadCall: async () => activeCall(),
      loadDestination: async () =>
        adminProfile({
          id: FINANCE_ID,
          role: "finance_admin",
          phone: "+15550001111",
        }),
      updateCall: async () => {
        throw new Error("unauthorized destination must not update");
      },
      redirectCall: async () => {
        throw new Error("unauthorized destination must not call Twilio");
      },
    },
  });

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 403);
  }
});

test("finance admin cannot initiate transfer even if destination is valid", async () => {
  const result = await executeAdminVoiceTransfer({
    actor: { userId: FINANCE_ID, role: "finance_admin", isFounder: false },
    callId: CALL_ID,
    destinationUserId: ADMIN_B_ID,
    deps: {
      loadCall: async () => activeCall(),
      loadDestination: async () => adminProfile(),
      updateCall: async () => {
        throw new Error("unauthorized actor must not update");
      },
      redirectCall: async () => {
        throw new Error("unauthorized actor must not call Twilio");
      },
    },
  });

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.equal(result.status, 403);
  }
});

test("raw destination phone from the browser is rejected", () => {
  const parsed = parseTransferRequest({
    callId: CALL_ID,
    destinationPhone: ADMIN_B_PHONE,
  });
  assert.equal(parsed.ok, false);
});

test("sensitive Twilio credentials are redacted from logs", () => {
  const redacted = redactAdminVoiceLog({
    authToken: "super-secret-token",
    Authorization: "Basic abcdef",
    TWILIO_AUTH_TOKEN: "live-token",
    Twiml: `<Dial><Number>${ADMIN_B_PHONE}</Number></Dial>`,
    from: PUBLIC_NUMBER,
  }) as Record<string, unknown>;

  const serialized = JSON.stringify(redacted);
  assert.equal(redacted.authToken, "[redacted]");
  assert.equal(redacted.Authorization, "[redacted]");
  assert.equal(redacted.TWILIO_AUTH_TOKEN, "[redacted]");
  assert.equal(redacted.Twiml, "[redacted]");
  assert.doesNotMatch(serialized, /super-secret-token/);
  assert.doesNotMatch(serialized, /live-token/);
  assert.doesNotMatch(serialized, /Basic abcdef/);
  assert.doesNotMatch(serialized, /\+19294924563/);
});

test("existing masked Voice routing still wins when a call session matches", () => {
  assert.equal(
    resolveIncomingVoiceRoute({ hasFrom: true, matchedSession: true }),
    "masked",
  );
  assert.equal(
    resolveIncomingVoiceRoute({ hasFrom: true, matchedSession: false }),
    "support",
  );
  assert.equal(
    resolveIncomingVoiceRoute({ hasFrom: false, matchedSession: false }),
    "support",
  );
});

test("support and transfer TwiML keep the public MMD number as caller ID", () => {
  const previous = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_PHONE_NUMBER = PUBLIC_NUMBER;
  try {
    const xml = buildAdminDialTwiml({
      destPhone: ADMIN_B_PHONE,
      includeWelcome: true,
    });
    assert.match(xml, /callerId="\+19294924563"/);
    assert.match(xml, /<Number>\+15551230001<\/Number>/);
    assert.equal(getTwilioPhoneNumber(), PUBLIC_NUMBER);
    assert.doesNotMatch(xml, /TWILIO_AUTH_TOKEN/);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = previous;
  }
});

test("inbound support row is stored against the Twilio parent CallSid", () => {
  const row = buildInboundAdminVoiceCallRow({
    callSid: "CAcccccccccccccccccccccccccccccccc",
    fromPhone: "5559876543",
    supportPhone: ADMIN_A_PHONE,
    nowIso: "2026-08-25T00:00:00.000Z",
  });
  assert.ok(row);
  assert.equal(row?.parent_call_sid, "CAcccccccccccccccccccccccccccccccc");
  assert.equal(row?.from_phone, "+15559876543");
  assert.equal(row?.current_admin_phone, ADMIN_A_PHONE);
  assert.equal(row?.status, "ringing");
});

test("transferred calls keep transferred status until the parent call ends", () => {
  assert.equal(mapTwilioStatusToAdminVoice("ringing", "transferred"), "transferred");
  assert.equal(mapTwilioStatusToAdminVoice("in-progress", "transferred"), "transferred");
  assert.equal(mapTwilioStatusToAdminVoice("completed", "transferred"), "completed");
  assert.equal(mapTwilioStatusToAdminVoice("completed", "completed"), "completed");
  assert.equal(mapTwilioStatusToAdminVoice("ringing", "completed"), null);
});
