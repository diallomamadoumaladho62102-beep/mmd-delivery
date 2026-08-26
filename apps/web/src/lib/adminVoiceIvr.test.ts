import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

import {
  ADMIN_VOICE_SERVICE_LABELS,
  IVR_DIGIT_TO_SERVICE,
  IVR_MENU_PROMPT,
  IVR_REPEAT_DIGIT,
  buildIvrGatherTwiml,
  buildIvrUnavailableTwiml,
  computeAdminVoiceDashboardStats,
  decideIvrGather,
  getIvrVoiceLocales,
  mergeAdminVoiceRealtimeRows,
  pickInboundSupportDestination,
  resolveIvrDigit,
  shouldAlertIncomingAdminVoice,
  shouldStopIncomingAdminVoiceAlert,
} from "./adminVoiceIvr";
import {
  assertEligibleAdminVoiceDestination,
  publicAdminVoiceCallView,
  resolveIncomingVoiceRoute,
  type AdminVoiceCallRow,
  type AdminVoiceDestinationProfile,
} from "./adminVoiceTransfer";
import {
  getTwilioWebhookUrl,
  validateTwilioSignature,
} from "./twilioRequestValidation";
import { TWILIO_PRODUCTION_BASE_URL } from "./twilioProductionUrls";

const AUTH_TOKEN = "test_twilio_auth_token_32chars!!";

function sign(url: string, params: Record<string, string>, token = AUTH_TOKEN) {
  const keys = Object.keys(params).sort();
  let payload = url;
  for (const key of keys) payload += key + params[key];
  return createHmac("sha1", token).update(payload, "utf8").digest("base64");
}

function adminProfile(
  overrides: Partial<AdminVoiceDestinationProfile> = {},
): AdminVoiceDestinationProfile {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    full_name: "Admin B",
    role: "support_admin",
    is_founder: false,
    phone: "+15551230001",
    account_status: "active",
    ...overrides,
  };
}

test("IVR digits map to typed support services", () => {
  assert.equal(resolveIvrDigit("1")?.service, "delivery");
  assert.equal(resolveIvrDigit("2")?.service, "package");
  assert.equal(resolveIvrDigit("3")?.service, "payment");
  assert.equal(resolveIvrDigit("4")?.service, "taxi");
  assert.equal(resolveIvrDigit("5")?.service, "restaurant");
  assert.equal(resolveIvrDigit("6")?.service, "account");
  assert.equal(resolveIvrDigit("7"), null);
  assert.equal(resolveIvrDigit("8"), null);
  assert.equal(resolveIvrDigit("0"), null);
  assert.equal(resolveIvrDigit(IVR_REPEAT_DIGIT), null);
  assert.equal(Object.keys(IVR_DIGIT_TO_SERVICE).length, 6);
});

test("DTMF 1 through 6 connect to the matching service", () => {
  for (const [digit, service] of Object.entries(IVR_DIGIT_TO_SERVICE)) {
    const decision = decideIvrGather({ digits: digit, attempt: 0 });
    assert.equal(decision.action, "connect");
    if (decision.action === "connect") {
      assert.equal(decision.service, service);
      assert.equal(decision.digit, digit);
    }
  }
});

test("DTMF 9 repeats the menu without marking the input invalid", () => {
  const repeat = decideIvrGather({ digits: "9", attempt: 0 });
  assert.equal(repeat.action, "repeat");
  if (repeat.action === "repeat") {
    assert.equal(repeat.invalid, false);
    assert.equal(repeat.attempt, 0);
  }
});

test("IVR invalid digit repeats the menu without connecting", () => {
  const invalid = decideIvrGather({ digits: "7", attempt: 0 });
  assert.equal(invalid.action, "repeat");
  if (invalid.action === "repeat") {
    assert.equal(invalid.invalid, true);
  }
});

test("IVR empty input repeats then falls back to general support", () => {
  const first = decideIvrGather({ digits: "", attempt: 0 });
  assert.equal(first.action, "repeat");
  const second = decideIvrGather({ digits: "", attempt: 1 });
  assert.equal(second.action, "repeat");
  const fallback = decideIvrGather({ digits: "", attempt: 2 });
  assert.equal(fallback.action, "fallback");
  if (fallback.action === "fallback") {
    assert.equal(fallback.service, "general");
  }
});

test("public support TwiML includes the bilingual IVR gather menu", () => {
  const xml = buildIvrGatherTwiml({ attempt: 0 });
  assert.match(xml, /<Gather/);
  assert.match(xml, /\/api\/twilio\/voice\/ivr/);
  assert.match(xml, /attempt=0/);
  assert.match(xml, /press 1/);
  assert.match(xml, /appuyez sur 1/);
  assert.match(xml, /language="fr-FR"/);
  assert.match(xml, /language="en-US"/);
  assert.doesNotMatch(xml, /TWILIO_AUTH_TOKEN/);
  assert.match(IVR_MENU_PROMPT.en, /Welcome to MMD Delivery/);
  assert.match(IVR_MENU_PROMPT.fr, /Bienvenue chez MMD Delivery/);
  assert.deepEqual(getIvrVoiceLocales("fr,en"), ["fr", "en"]);
});

test("unavailable TwiML leaves a voicemail instead of dialing", () => {
  const xml = buildIvrUnavailableTwiml();
  assert.match(xml, /<Record/);
  assert.doesNotMatch(xml, /<Dial/);
  assert.match(xml, /indisponibles/);
  assert.match(xml, /currently unavailable/);
});

test("valid masked call sessions never enter the support IVR", () => {
  assert.equal(
    resolveIncomingVoiceRoute({ hasFrom: true, matchedSession: true }),
    "masked",
  );
  assert.equal(
    resolveIncomingVoiceRoute({ hasFrom: true, matchedSession: false }),
    "support",
  );
});

test("incoming ringing plays an alert and answered/completed stop it", () => {
  assert.equal(shouldAlertIncomingAdminVoice("in_ivr"), true);
  assert.equal(shouldAlertIncomingAdminVoice("ringing"), true);
  assert.equal(shouldAlertIncomingAdminVoice("answered"), false);
  assert.equal(shouldAlertIncomingAdminVoice("transferred"), false);
  assert.equal(shouldStopIncomingAdminVoiceAlert("completed"), true);
  assert.equal(shouldStopIncomingAdminVoiceAlert("missed"), true);
  assert.equal(shouldStopIncomingAdminVoiceAlert("expired"), true);
});

test("dashboard stats count services and live statuses", () => {
  const stats = computeAdminVoiceDashboardStats([
    { status: "in_ivr", service: "delivery" },
    { status: "answered", service: "taxi" },
    { status: "transferred", service: "payment" },
    { status: "completed", service: "general" },
    { status: "missed", service: "account" },
  ]);
  assert.equal(stats.incoming, 1);
  assert.equal(stats.answered, 1);
  assert.equal(stats.transferred, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.missed, 1);
  assert.equal(stats.byService.delivery, 1);
  assert.equal(ADMIN_VOICE_SERVICE_LABELS.delivery, "Delivery");
});

test("incoming handler keeps masked Dial and only support uses IVR gather", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const incoming = readFileSync(join(dir, "twilioVoiceIncoming.ts"), "utf8");
  assert.match(incoming, /publicSupportStartIvr/);
  assert.match(incoming, /buildIvrGatherTwiml/);
  assert.match(incoming, /Welcome to MMD Delivery and Ride/);
  assert.match(incoming, /session\.target_phone/);
  assert.doesNotMatch(incoming, /publicSupportDialAdmin/);
  assert.doesNotMatch(incoming, /TWILIO_AUTH_TOKEN/);
});

test("Twilio IVR webhook signature includes the attempt query string", () => {
  const url = `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/ivr?attempt=1`;
  const params = {
    CallSid: "CAivr0000000000000000000000000001",
    Digits: "1",
    From: "+15551234567",
  };
  const signature = sign(url, params);
  assert.equal(validateTwilioSignature(AUTH_TOKEN, signature, url, params), true);
  assert.equal(
    validateTwilioSignature(AUTH_TOKEN, "tampered", url, params),
    false,
  );
  assert.equal(
    validateTwilioSignature(
      AUTH_TOKEN,
      signature,
      `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/ivr?attempt=0`,
      params,
    ),
    false,
  );
});

test("getTwilioWebhookUrl keeps IVR query params with the production override", () => {
  const previous = process.env.TWILIO_WEBHOOK_BASE_URL;
  process.env.TWILIO_WEBHOOK_BASE_URL = TWILIO_PRODUCTION_BASE_URL;
  try {
    const req = {
      headers: new Headers({
        host: "preview.vercel.app",
        "x-forwarded-proto": "https",
      }),
      nextUrl: { pathname: "/api/twilio/voice/ivr", search: "?attempt=2" },
    } as Parameters<typeof getTwilioWebhookUrl>[0];

    assert.equal(
      getTwilioWebhookUrl(req, "/api/twilio/voice/ivr"),
      `${TWILIO_PRODUCTION_BASE_URL}/api/twilio/voice/ivr?attempt=2`,
    );
  } finally {
    if (previous === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
    else process.env.TWILIO_WEBHOOK_BASE_URL = previous;
  }
});

test("a single eligible admin is a valid inbound destination", () => {
  const picked = pickInboundSupportDestination({
    profiles: [adminProfile()],
    preferredPhone: "+15551230001",
  });
  assert.ok(picked);
  assert.equal(picked?.userId, adminProfile().id);
  assert.equal(picked?.phone, "+15551230001");
});

test("no eligible admin and no valid preferred phone yields unavailable", () => {
  const picked = pickInboundSupportDestination({
    profiles: [
      adminProfile({ role: "client", phone: "+15550001111" }),
      adminProfile({
        id: "driver-1",
        role: "driver",
        phone: "+15550002222",
      }),
    ],
    preferredPhone: null,
  });
  assert.equal(picked, null);
});

test("inactive admin, client, driver, and arbitrary users cannot receive support calls", () => {
  assert.equal(
    assertEligibleAdminVoiceDestination(
      adminProfile({ account_status: "suspended" }),
    ).ok,
    false,
  );
  assert.equal(
    assertEligibleAdminVoiceDestination(adminProfile({ role: "client" })).ok,
    false,
  );
  assert.equal(
    assertEligibleAdminVoiceDestination(adminProfile({ role: "driver" })).ok,
    false,
  );
  assert.equal(assertEligibleAdminVoiceDestination(null).ok, false);
});

test("international admin destinations are refused", () => {
  const refused = assertEligibleAdminVoiceDestination(
    adminProfile({ phone: "+33123456789" }),
  );
  assert.equal(refused.ok, false);
  if (refused.ok === false) {
    assert.equal(refused.status, 409);
  }
});

test("public admin voice views mask caller numbers", () => {
  const view = publicAdminVoiceCallView({
    id: "11111111-1111-4111-8111-111111111111",
    parent_call_sid: "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    from_phone: "+15559876543",
    current_admin_user_id: null,
    current_admin_phone: "+19297408722",
    status: "in_ivr",
    service: "delivery",
    created_at: "2026-08-25T00:00:00.000Z",
  } satisfies AdminVoiceCallRow);
  assert.equal(view.fromPhone, "***6543");
  assert.doesNotMatch(JSON.stringify(view), /\+15559876543/);
});

test("realtime merge updates status without duplicating rows", () => {
  const first = mergeAdminVoiceRealtimeRows(
    [],
    "INSERT",
    { id: "call-1", status: "in_ivr" },
  );
  const duplicateInsert = mergeAdminVoiceRealtimeRows(first, "INSERT", {
    id: "call-1",
    status: "in_ivr",
  });
  const updated = mergeAdminVoiceRealtimeRows(duplicateInsert, "UPDATE", {
    id: "call-1",
    status: "answered",
  });
  const transferred = mergeAdminVoiceRealtimeRows(updated, "UPDATE", {
    id: "call-1",
    status: "transferred",
  });
  const completed = mergeAdminVoiceRealtimeRows(transferred, "UPDATE", {
    id: "call-1",
    status: "completed",
  });
  const reconnect = mergeAdminVoiceRealtimeRows(completed, "*", {
    id: "call-1",
    status: "completed",
  });
  const cleared = mergeAdminVoiceRealtimeRows(reconnect, "DELETE", {
    id: "call-1",
    status: "completed",
  });

  assert.equal(first.length, 1);
  assert.equal(duplicateInsert.length, 1);
  assert.equal(updated[0]?.status, "answered");
  assert.equal(transferred[0]?.status, "transferred");
  assert.equal(completed[0]?.status, "completed");
  assert.equal(reconnect.length, 1);
  assert.equal(cleared.length, 0);
});
