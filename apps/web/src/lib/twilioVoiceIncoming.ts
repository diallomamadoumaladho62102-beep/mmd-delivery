import type { NextRequest } from "next/server";

import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";
import { getTwilioVoiceStatusCallbackUrl } from "@/lib/twilioProductionUrls";
import { normalizePhoneE164, phonesEquivalent } from "@/lib/phoneE164";

const MMD_TWILIO_NUMBER = getTwilioPhoneNumber();
const ADMIN_SUPPORT_PHONE =
  process.env.MMD_ADMIN_SUPPORT_PHONE || "+19297408722";

const ROUTABLE_SESSION_STATUSES = ["active", "ringing", "connected"] as const;

function escapeXml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function twilioVoiceTwiml(xml: string) {
  return new Response(xml.trim(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export function twilioVoiceSay(message: string) {
  return twilioVoiceTwiml(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">${escapeXml(message)}</Say>
</Response>
  `);
}

function publicSupportDialAdmin() {
  return twilioVoiceTwiml(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">
    Welcome to MMD Delivery and Ride support.
    Thank you for calling us.
    For safety and quality purposes, this call may be recorded.
    Please wait while we connect you to our support team.
  </Say>

  <Dial
    callerId="${escapeXml(MMD_TWILIO_NUMBER)}"
    answerOnBridge="true"
    timeout="25"
    record="record-from-answer-dual"
  >
    <Number>${escapeXml(ADMIN_SUPPORT_PHONE)}</Number>
  </Dial>

  <Say voice="alice" language="en-US">
    Our support team is not available right now.
    Please leave your name, phone number, order or trip details, and a short message after the beep.
  </Say>

  <Record
    maxLength="180"
    playBeep="true"
    transcribe="false"
    trim="trim-silence"
  />

  <Say voice="alice" language="en-US">
    Thank you for calling MMD Delivery and Ride.
    We appreciate your trust. Goodbye.
  </Say>
</Response>
  `);
}

export async function handleTwilioVoiceIncoming(req: NextRequest) {
  const supabaseAdmin = buildSupabaseAdminClient();
  const formData = await req.formData();
  const twilioParams = await formDataToParamRecord(formData);
  const twilioAuth = await assertTwilioWebhookRequest(req, twilioParams);

  if (twilioAuth.ok === false) {
    return new Response(twilioAuth.message, { status: twilioAuth.status });
  }

  const from = normalizePhoneE164(String(formData.get("From") || "").trim());
  const callSid = String(formData.get("CallSid") || "").trim();

  if (!from) {
    return publicSupportDialAdmin();
  }

  const now = new Date().toISOString();

  const { data: sessions, error: sessionError } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .in("status", [...ROUTABLE_SESSION_STATUSES])
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(25);

  const session =
    (sessions ?? []).find((row) =>
      phonesEquivalent(
        (row as { caller_phone?: string | null }).caller_phone,
        from,
      ),
    ) ?? null;

  if (sessionError) {
    console.error("[twilio/voice/incoming] call_sessions lookup error", {
      path: req.nextUrl.pathname,
      code: sessionError.code,
    });
    return publicSupportDialAdmin();
  }

  if (!session) {
    return twilioVoiceSay(
      "No active MMD Delivery call session was found for this number. Please start your call from the MMD Delivery app, or contact support.",
    );
  }

  const targetPhone = normalizePhoneE164(String(session.target_phone || "")) || "";
  const proxyNumber = normalizePhoneE164(
    String(session.proxy_number || MMD_TWILIO_NUMBER),
  ) || MMD_TWILIO_NUMBER;

  if (!targetPhone) {
    return twilioVoiceSay(
      "This call session is incomplete. Please return to the MMD Delivery app and try again.",
    );
  }

  await supabaseAdmin
    .from("call_sessions")
    .update({
      status: "ringing",
      started_at: session.started_at ?? now,
      twilio_call_sid: callSid || session.twilio_call_sid || null,
    })
    .eq("id", session.id);

  const statusCallbackUrl = getTwilioVoiceStatusCallbackUrl();

  return twilioVoiceTwiml(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">
    Welcome to MMD Delivery and Ride.
    For safety and quality purposes, this call may be recorded.
    Please wait while we connect your call.
  </Say>

  <Dial
    callerId="${escapeXml(proxyNumber)}"
    answerOnBridge="true"
    timeout="25"
    record="record-from-answer-dual"
    statusCallback="${escapeXml(statusCallbackUrl)}"
    statusCallbackEvent="initiated ringing answered completed"
    statusCallbackMethod="POST"
  >
    <Number>${escapeXml(targetPhone)}</Number>
  </Dial>

  <Say voice="alice" language="en-US">
    We were unable to connect your call.
    Please try again later or contact MMD Delivery support.
  </Say>
</Response>
  `);
}
