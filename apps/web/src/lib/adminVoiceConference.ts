import { getTwilioVoiceStatusCallbackUrl } from "@/lib/twilioProductionUrls";

function escapeTwiml(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function adminVoiceConferenceName(callId: string): string {
  const id = String(callId || "").trim();
  return id ? `mmd-admin-${id}` : "";
}

export function buildConferenceJoinTwiml(params: {
  conferenceName: string;
  startOnEnter?: boolean;
  endOnExit?: boolean;
  muted?: boolean;
  prefixSay?: string;
}): string {
  const name = String(params.conferenceName || "").trim();
  const startOnEnter = params.startOnEnter !== false;
  const endOnExit = params.endOnExit === true;
  const muted = params.muted === true;
  const prefix = String(params.prefixSay || "").trim();
  const statusCallbackUrl = getTwilioVoiceStatusCallbackUrl();
  const say = prefix
    ? `
  <Say voice="alice" language="en-US">${escapeTwiml(prefix)}</Say>
`
    : "";

  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
${say}
  <Dial
    answerOnBridge="true"
    record="record-from-answer-dual"
    statusCallback="${escapeTwiml(statusCallbackUrl)}"
    statusCallbackEvent="initiated ringing answered completed"
    statusCallbackMethod="POST"
  >
    <Conference
      startConferenceOnEnter="${startOnEnter ? "true" : "false"}"
      endConferenceOnExit="${endOnExit ? "true" : "false"}"
      beep="false"
      waitUrl="https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical"
      muted="${muted ? "true" : "false"}"
    >${escapeTwiml(name)}</Conference>
  </Dial>
</Response>
  `.trim();
}

export function buildTwilioCallsUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;
}

export function buildTwilioConferenceLookupUrl(
  accountSid: string,
  friendlyName: string,
): string {
  const query = new URLSearchParams({
    FriendlyName: friendlyName,
    Status: "in-progress",
  });
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Conferences.json?${query.toString()}`;
}

export function buildTwilioParticipantHoldUrl(
  accountSid: string,
  conferenceSid: string,
  callSid: string,
): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Conferences/${conferenceSid}/Participants/${callSid}.json`;
}

export async function createTwilioOutboundCall(params: {
  accountSid: string;
  authToken: string;
  to: string;
  from: string;
  twiml: string;
  fetchImpl?: typeof fetch;
}): Promise<
  { ok: true; sid: string; status: number } | { ok: false; status: number; error: string }
> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");
  const body = new URLSearchParams({
    To: params.to,
    From: params.from,
    Twiml: params.twiml,
  });
  const response = await fetchImpl(buildTwilioCallsUrl(params.accountSid), {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!response.ok || !json?.sid) {
    return {
      ok: false,
      status: response.status >= 400 && response.status < 600 ? 502 : 500,
      error: "Unable to place the outbound support call",
    };
  }
  return { ok: true, sid: json.sid, status: 200 };
}

export async function lookupInProgressConferenceSid(params: {
  accountSid: string;
  authToken: string;
  friendlyName: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");
  const response = await fetchImpl(
    buildTwilioConferenceLookupUrl(params.accountSid, params.friendlyName),
    {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    },
  );
  const json = (await response.json().catch(() => null)) as {
    conferences?: Array<{ sid?: string }>;
  } | null;
  return json?.conferences?.[0]?.sid ?? null;
}

export async function setTwilioParticipantHold(params: {
  accountSid: string;
  authToken: string;
  conferenceSid: string;
  callSid: string;
  hold: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");
  const response = await fetchImpl(
    buildTwilioParticipantHoldUrl(
      params.accountSid,
      params.conferenceSid,
      params.callSid,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Hold: params.hold ? "true" : "false" }).toString(),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 400 && response.status < 600 ? 502 : 500,
      error: params.hold ? "Unable to hold the call" : "Unable to resume the call",
    };
  }
  return { ok: true, status: 200 };
}

export function isAdminVoiceHoldAvailable(conferenceName: string | null | undefined): boolean {
  return Boolean(String(conferenceName ?? "").trim());
}
