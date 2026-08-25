import type { NextRequest } from "next/server";

import {
  buildAdminDialTwiml,
  buildInboundAdminVoiceCallRow,
  getAdminSupportPhone,
  resolveIncomingVoiceRoute,
} from "@/lib/adminVoiceTransfer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";
import { getTwilioVoiceStatusCallbackUrl } from "@/lib/twilioProductionUrls";
import { normalizePhoneE164, phonesEquivalent } from "@/lib/phoneE164";

const MMD_TWILIO_NUMBER = getTwilioPhoneNumber();

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

async function persistInboundSupportCall(params: {
  supabaseAdmin: ReturnType<typeof buildSupabaseAdminClient>;
  callSid: string;
  fromPhone: string | null;
}) {
  const row = buildInboundAdminVoiceCallRow({
    callSid: params.callSid,
    fromPhone: params.fromPhone,
    supportPhone: getAdminSupportPhone(),
    nowIso: new Date().toISOString(),
  });
  if (!row) return;

  const { error } = await params.supabaseAdmin
    .from("admin_voice_calls")
    .upsert(row, { onConflict: "parent_call_sid" });

  if (error) {
    console.error("[twilio/voice/incoming] admin_voice_calls persist failed", {
      path: "/api/twilio/voice/incoming",
      code: error.code,
    });
  }
}

async function publicSupportDialAdmin(params: {
  supabaseAdmin: ReturnType<typeof buildSupabaseAdminClient>;
  callSid: string;
  fromPhone: string | null;
}) {
  try {
    await persistInboundSupportCall(params);
  } catch {
    console.error("[twilio/voice/incoming] admin_voice_calls persist failed", {
      path: "/api/twilio/voice/incoming",
    });
  }

  return twilioVoiceTwiml(
    buildAdminDialTwiml({
      destPhone: getAdminSupportPhone(),
      callerId: MMD_TWILIO_NUMBER,
      includeWelcome: true,
    }),
  );
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
    return publicSupportDialAdmin({
      supabaseAdmin,
      callSid,
      fromPhone: null,
    });
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
    return publicSupportDialAdmin({
      supabaseAdmin,
      callSid,
      fromPhone: from,
    });
  }

  if (
    !session ||
    resolveIncomingVoiceRoute({
      hasFrom: true,
      matchedSession: Boolean(session),
    }) === "support"
  ) {
    return publicSupportDialAdmin({
      supabaseAdmin,
      callSid,
      fromPhone: from,
    });
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
