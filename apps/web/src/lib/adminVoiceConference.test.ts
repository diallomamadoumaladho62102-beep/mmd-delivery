import assert from "node:assert/strict";
import test from "node:test";

import {
  executeAdminVoiceCallAction,
  parseAdminVoiceCallAction,
} from "./adminVoiceCallAction";
import { actorOwnsAdminVoiceCall } from "./adminVoiceCallControl";
import {
  adminVoiceConferenceName,
  buildConferenceJoinTwiml,
  buildTwilioCallsUrl,
  buildTwilioConferenceLookupUrl,
  buildTwilioParticipantHoldUrl,
  createTwilioOutboundCall,
  isAdminVoiceHoldAvailable,
  setTwilioParticipantHold,
} from "./adminVoiceConference";
import {
  executeAdminVoiceTransfer,
  mapTwilioStatusToAdminVoice,
  type AdminVoiceCallRow,
  type AdminVoiceDestinationProfile,
} from "./adminVoiceTransfer";
import { formatCallDurationClock } from "./callSessionDisplay";

const CALL_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_A_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_B_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_A_PHONE = "+19297408722";
const ADMIN_B_PHONE = "+15551230001";
const PARENT_SID = "CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CHILD_SID = "CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function conferenceCall(overrides: Partial<AdminVoiceCallRow> = {}): AdminVoiceCallRow {
  return {
    id: CALL_ID,
    parent_call_sid: PARENT_SID,
    child_call_sid: CHILD_SID,
    from_phone: "+15559876543",
    current_admin_user_id: ADMIN_A_ID,
    assigned_admin_user_id: ADMIN_A_ID,
    current_admin_phone: ADMIN_A_PHONE,
    conference_name: adminVoiceConferenceName(CALL_ID),
    on_hold: false,
    status: "answered",
    created_at: "2026-08-29T12:00:00.000Z",
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

test("conference TwiML joins a named room without exposing secrets", () => {
  const xml = buildConferenceJoinTwiml({
    conferenceName: "mmd-admin-abc",
    startOnEnter: true,
    endOnExit: true,
    prefixSay: "Please wait",
  });
  assert.match(xml, /<Conference/);
  assert.match(xml, /mmd-admin-abc/);
  assert.match(xml, /startConferenceOnEnter="true"/);
  assert.match(xml, /endConferenceOnExit="true"/);
  assert.doesNotMatch(xml, /TWILIO_AUTH_TOKEN|authToken|Basic /);
});

test("hold participant URL and outbound call URL stay on the Twilio REST API", () => {
  assert.match(
    buildTwilioParticipantHoldUrl("ACxxx", "CFyyy", "CAzzz"),
    /\/Conferences\/CFyyy\/Participants\/CAzzz\.json$/,
  );
  assert.match(buildTwilioCallsUrl("ACxxx"), /\/Calls\.json$/);
  assert.match(buildTwilioConferenceLookupUrl("ACxxx", "mmd-admin-1"), /FriendlyName=mmd-admin-1/);
  assert.equal(isAdminVoiceHoldAvailable("mmd-admin-1"), true);
  assert.equal(isAdminVoiceHoldAvailable(""), false);
});

test("setTwilioParticipantHold posts Hold=true to the customer participant", async () => {
  const seen: { url: string; body: string }[] = [];
  const result = await setTwilioParticipantHold({
    accountSid: "ACxxx",
    authToken: "token",
    conferenceSid: "CFyyy",
    callSid: PARENT_SID,
    hold: true,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.match(seen[0].url, /Participants\/CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\.json/);
  assert.match(seen[0].body, /Hold=true/);
});

test("createTwilioOutboundCall records the new Call SID", async () => {
  const result = await createTwilioOutboundCall({
    accountSid: "ACxxx",
    authToken: "token",
    to: ADMIN_B_PHONE,
    from: "+19294924563",
    twiml: "<Response></Response>",
    fetchImpl: async () =>
      new Response(JSON.stringify({ sid: "CAnewcallsid000000000000000000000" }), {
        status: 201,
      }),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.sid, "CAnewcallsid000000000000000000000");
});

test("hold and resume update Twilio then persist on_hold", async () => {
  let updated: Record<string, unknown> | null = null;
  let holdValue: boolean | null = null;
  const supabaseAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: conferenceCall(), error: null }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          updated = patch;
          return {
            eq() {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  const hold = await executeAdminVoiceCallAction({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    action: "hold",
    supabaseAdmin: supabaseAdmin as never,
    setHold: async ({ hold }) => {
      holdValue = hold;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(hold.ok, true);
  assert.equal(holdValue, true);
  assert.equal(updated?.status, "on_hold");
  assert.equal(updated?.on_hold, true);

  const resumeAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: conferenceCall({ status: "on_hold", on_hold: true }),
                  error: null,
                }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          updated = patch;
          return { eq() { return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
  const resume = await executeAdminVoiceCallAction({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    action: "resume",
    supabaseAdmin: resumeAdmin as never,
    setHold: async ({ hold }) => {
      holdValue = hold;
      return { ok: true, status: 200 };
    },
  });
  assert.equal(resume.ok, true);
  assert.equal(holdValue, false);
  assert.equal(updated?.status, "answered");
  assert.equal(updated?.on_hold, false);
});

test("hold is refused when the call is not a conference", async () => {
  const supabaseAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: conferenceCall({ conference_name: null }),
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const result = await executeAdminVoiceCallAction({
    actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    action: "hold",
    supabaseAdmin: supabaseAdmin as never,
    setHold: async () => {
      throw new Error("must not call Twilio");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.equal(result.status, 409);
});

test("another admin cannot hold or end a claimed call", async () => {
  const supabaseAdmin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: conferenceCall(), error: null }),
              };
            },
          };
        },
      };
    },
  };
  const result = await executeAdminVoiceCallAction({
    actor: { userId: ADMIN_B_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    action: "end",
    supabaseAdmin: supabaseAdmin as never,
    hangup: async () => {
      throw new Error("must not hang up someone else's call");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.equal(result.status, 403);
});

test("founder can control a claimed support call", () => {
  assert.equal(
    actorOwnsAdminVoiceCall({
      actorUserId: ADMIN_B_ID,
      isFounder: true,
      assignedAdminUserId: ADMIN_A_ID,
      currentAdminUserId: ADMIN_A_ID,
    }),
    true,
  );
  assert.equal(
    actorOwnsAdminVoiceCall({
      actorUserId: ADMIN_B_ID,
      isFounder: false,
      assignedAdminUserId: ADMIN_A_ID,
      currentAdminUserId: ADMIN_A_ID,
    }),
    false,
  );
});

test("conference transfer adds a new participant and hangs up the previous admin", async () => {
  const previous = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_PHONE_NUMBER = "+19294924563";
  let outboundTwiml = "";
  let hungUp: string | null = null;
  let redirected = false;
  try {
    const result = await executeAdminVoiceTransfer({
      actor: { userId: ADMIN_A_ID, role: "support_admin", isFounder: false },
      callId: CALL_ID,
      destinationUserId: ADMIN_B_ID,
      deps: {
        loadCall: async () => conferenceCall(),
        loadDestination: async () => adminProfile(),
        updateCall: async () => undefined,
        createOutboundCall: async ({ twiml }) => {
          outboundTwiml = twiml;
          return { ok: true, sid: "CAnewadmin000000000000000000000000", status: 200 };
        },
        hangupCall: async (sid) => {
          hungUp = sid;
          return { ok: true, status: 200 };
        },
        redirectCall: async () => {
          redirected = true;
          return { ok: true, status: 200 };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(redirected, false);
    assert.equal(hungUp, CHILD_SID);
    assert.match(outboundTwiml, /<Conference/);
    assert.match(outboundTwiml, /mmd-admin-11111111-1111-4111-8111-111111111111/);
  } finally {
    if (previous === undefined) delete process.env.TWILIO_PHONE_NUMBER;
    else process.env.TWILIO_PHONE_NUMBER = previous;
  }
});

test("another admin cannot transfer a claimed conference call", async () => {
  const result = await executeAdminVoiceTransfer({
    actor: { userId: ADMIN_B_ID, role: "support_admin", isFounder: false },
    callId: CALL_ID,
    destinationUserId: ADMIN_A_ID,
    deps: {
      loadCall: async () => conferenceCall(),
      loadDestination: async () => adminProfile({ id: ADMIN_A_ID, phone: ADMIN_A_PHONE }),
      updateCall: async () => {
        throw new Error("must not update");
      },
      redirectCall: async () => {
        throw new Error("must not redirect");
      },
    },
  });
  assert.equal(result.ok, false);
  if (result.ok === false) assert.equal(result.status, 403);
});

test("parent in-progress does not leave IVR; dial child answered does", () => {
  assert.equal(mapTwilioStatusToAdminVoice("in-progress", "in_ivr"), "in_ivr");
  assert.equal(
    mapTwilioStatusToAdminVoice("answered", "in_ivr", { isDialLeg: true }),
    "answered",
  );
  assert.equal(mapTwilioStatusToAdminVoice("busy", "ringing", { isDialLeg: true }), "busy");
  assert.equal(
    mapTwilioStatusToAdminVoice("no-answer", "ringing", { isDialLeg: true }),
    "no_answer",
  );
  assert.equal(mapTwilioStatusToAdminVoice("in-progress", "on_hold"), "on_hold");
});

test("duration clock never invents huge values and formats human clocks", () => {
  assert.equal(formatCallDurationClock(35), "00:35");
  assert.equal(formatCallDurationClock(342), "05:42");
  assert.equal(formatCallDurationClock(3867), "1:04:27");
  assert.equal(formatCallDurationClock(null), "—");
  assert.equal(formatCallDurationClock(-4), "—");
});

test("parseAdminVoiceCallAction accepts hold and resume", () => {
  assert.equal(parseAdminVoiceCallAction({ action: "hold" }), "hold");
  assert.equal(parseAdminVoiceCallAction({ action: "resume" }), "resume");
  assert.equal(parseAdminVoiceCallAction({ action: "mute" }), null);
});
