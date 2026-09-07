import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

import {
  ADMIN_VOICE_SERVICE_LABELS,
  IVR_DIGIT_TO_LOCALE,
  IVR_DIGIT_TO_SERVICE,
  IVR_FF_TTS_NOTE,
  IVR_LANGUAGE_MENU_LINES,
  IVR_REPEAT_DIGIT,
  IVR_SERVICE_MENU_PROMPT,
  IVR_SUPPORTED_LOCALES,
  IVR_TWILIO_VOICE,
  buildIvrLanguageGatherTwiml,
  buildIvrServiceGatherTwiml,
  buildIvrUnavailableTwiml,
  computeAdminVoiceDashboardStats,
  decideIvrGather,
  decideIvrLanguageGather,
  getIvrVoiceLocales,
  mergeAdminVoiceRealtimeRows,
  pickInboundSupportDestination,
  resolveIvrDigit,
  resolveIvrLocaleDigit,
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

test("IVR language digits map 1=fr 2=en 3=es 4=ar 5=zh 6=ff", () => {
  assert.equal(resolveIvrLocaleDigit("1")?.locale, "fr");
  assert.equal(resolveIvrLocaleDigit("2")?.locale, "en");
  assert.equal(resolveIvrLocaleDigit("3")?.locale, "es");
  assert.equal(resolveIvrLocaleDigit("4")?.locale, "ar");
  assert.equal(resolveIvrLocaleDigit("5")?.locale, "zh");
  assert.equal(resolveIvrLocaleDigit("6")?.locale, "ff");
  assert.equal(resolveIvrLocaleDigit("7"), null);
  assert.equal(resolveIvrLocaleDigit("9"), null);
  assert.deepEqual(Object.keys(IVR_DIGIT_TO_LOCALE).sort(), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual([...IVR_SUPPORTED_LOCALES], ["fr", "en", "es", "ar", "zh", "ff"]);
});

test("language gather never connects a service before locale is chosen", () => {
  for (const digit of Object.keys(IVR_DIGIT_TO_LOCALE)) {
    const decision = decideIvrLanguageGather({ digits: digit, attempt: 0 });
    assert.equal(decision.action, "set_locale");
    if (decision.action === "set_locale") {
      assert.equal(
        decision.locale,
        IVR_DIGIT_TO_LOCALE[digit as keyof typeof IVR_DIGIT_TO_LOCALE],
      );
    }
  }
  const invalid = decideIvrLanguageGather({ digits: "7", attempt: 0 });
  assert.equal(invalid.action, "repeat");
  if (invalid.action === "repeat") assert.equal(invalid.invalid, true);

  const empty = decideIvrLanguageGather({ digits: "", attempt: 0 });
  assert.equal(empty.action, "repeat");
  if (empty.action === "repeat") assert.equal(empty.invalid, false);

  // Empty attempts never fall through to English service — stay on language menu.
  const stuck = decideIvrLanguageGather({ digits: "", attempt: 9 });
  assert.equal(stuck.action, "repeat");
});

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

test("public support TwiML starts with language menu, not service menu", () => {
  const xml = buildIvrLanguageGatherTwiml({ attempt: 0 });
  assert.match(xml, /<Gather/);
  assert.match(xml, /\/api\/twilio\/voice\/ivr/);
  assert.match(xml, /step=language/);
  assert.match(xml, /attempt=0/);
  assert.match(xml, /appuyez sur 1/);
  assert.match(xml, /press 2/);
  assert.match(xml, /presione 3/);
  assert.match(xml, /language="fr-FR"/);
  assert.match(xml, /language="en-US"/);
  assert.match(xml, /language="es-MX"/);
  assert.match(xml, /language="arb"/);
  assert.match(xml, /language="zh-CN"/);
  assert.doesNotMatch(xml, /Which service would you like/);
  assert.doesNotMatch(xml, /Quel service souhaitez-vous/);
  assert.doesNotMatch(xml, /TWILIO_AUTH_TOKEN/);
  assert.match(IVR_LANGUAGE_MENU_LINES.fr, /Bienvenue chez MMD Delivery/);
  assert.match(IVR_LANGUAGE_MENU_LINES.en, /For English, press 2/);
  assert.deepEqual(getIvrVoiceLocales("fr,en,es,ar,zh,ff"), [
    "fr",
    "en",
    "es",
    "ar",
    "zh",
    "ff",
  ]);
});

test("Fulfulde keeps locale ff with documented fr-FR TTS carrier", () => {
  assert.equal(IVR_DIGIT_TO_LOCALE["6"], "ff");
  assert.equal(IVR_TWILIO_VOICE.ff.language, "fr-FR");
  assert.match(IVR_FF_TTS_NOTE, /no native ff TTS/i);
  const xml = buildIvrServiceGatherTwiml({ locale: "ff", attempt: 0 });
  assert.match(xml, /locale=ff/);
  assert.doesNotMatch(xml, /Which service would you like/);
  assert.match(xml, /Holi sarwiis/);
});

test("service menu TwiML is monolingual for the selected locale", () => {
  for (const locale of IVR_SUPPORTED_LOCALES) {
    const xml = buildIvrServiceGatherTwiml({ locale, attempt: 0 });
    assert.match(xml, /step=service/);
    assert.match(xml, new RegExp(`locale=${locale}`));
    assert.match(xml, /<Gather/);
    assert.doesNotMatch(xml, /step=language/);
    // Must not blend English + French service prompts after locale pick.
    if (locale === "fr") {
      assert.match(xml, /Quel service souhaitez-vous/);
      assert.doesNotMatch(xml, /Which service would you like/);
    }
    if (locale === "en") {
      assert.match(xml, /Which service would you like/);
      assert.doesNotMatch(xml, /Quel service souhaitez-vous/);
    }
    assert.match(IVR_SERVICE_MENU_PROMPT[locale], /1/);
  }
});

test("unavailable TwiML leaves a voicemail instead of dialing", () => {
  const xml = buildIvrUnavailableTwiml("fr");
  assert.match(xml, /<Record/);
  assert.doesNotMatch(xml, /<Dial/);
  assert.match(xml, /indisponibles/);
  assert.doesNotMatch(xml, /currently unavailable/);
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

test("incoming handler keeps masked Dial and only support uses language IVR gather", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const incoming = readFileSync(join(dir, "twilioVoiceIncoming.ts"), "utf8");
  assert.match(incoming, /publicSupportStartIvr/);
  assert.match(incoming, /buildIvrLanguageGatherTwiml/);
  assert.match(incoming, /Welcome to MMD Delivery and Ride/);
  assert.match(incoming, /session\.target_phone/);
  assert.doesNotMatch(incoming, /publicSupportDialAdmin/);
  assert.doesNotMatch(incoming, /TWILIO_AUTH_TOKEN/);
});

test("IVR handler routes language before service and never defaults locale to en", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const ivr = readFileSync(join(dir, "twilioVoiceIvr.ts"), "utf8");
  assert.match(ivr, /decideIvrLanguageGather/);
  assert.match(ivr, /buildIvrLanguageGatherTwiml/);
  assert.match(ivr, /buildIvrServiceGatherTwiml/);
  assert.match(ivr, /step === "language" \|\| !localeFromQuery/);
  assert.doesNotMatch(ivr, /localeFromQuery \|\| "en"/);
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
