import { NextRequest } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";

export const runtime = "nodejs";

const MMD_TWILIO_NUMBER = getTwilioPhoneNumber();
const ADMIN_SUPPORT_PHONE =
  process.env.MMD_ADMIN_SUPPORT_PHONE || "+19297408722";

function escapeXml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function twiml(xml: string) {
  return new Response(xml.trim(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function say(message: string) {
  return twiml(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">${escapeXml(message)}</Say>
</Response>
  `);
}

function publicSupportDialAdmin() {
  return twiml(`
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

export async function GET() {
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  return say("MMD Delivery voice webhook (dev only). Use POST from Twilio.");
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = buildSupabaseAdminClient();
    const formData = await req.formData();
    const twilioParams = await formDataToParamRecord(formData);
    const twilioAuth = await assertTwilioWebhookRequest(req, twilioParams);

    if (twilioAuth.ok === false) {
      return new Response(twilioAuth.message, { status: twilioAuth.status });
    }

    const from = String(formData.get("From") || "").trim();
    const callSid = String(formData.get("CallSid") || "").trim();

    if (!from) {
      return publicSupportDialAdmin();
    }

    const now = new Date().toISOString();

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("call_sessions")
      .select("*")
      .eq("status", "active")
      .eq("caller_phone", from)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      console.error("[twilio/voice] call_sessions lookup error", sessionError);
      return publicSupportDialAdmin();
    }

    if (!session) {
      return publicSupportDialAdmin();
    }

    const targetPhone = String(session.target_phone || "").trim();
    const proxyNumber = String(session.proxy_number || MMD_TWILIO_NUMBER).trim();

    if (!targetPhone) {
      return say(
        "This call session is incomplete. Please return to the MMD Delivery app and try again."
      );
    }

    await supabaseAdmin
      .from("call_sessions")
      .update({
        status: "ringing",
        started_at: now,
        twilio_call_sid: callSid || null,
      })
      .eq("id", session.id);

    return twiml(`
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
  >
    <Number>${escapeXml(targetPhone)}</Number>
  </Dial>

  <Say voice="alice" language="en-US">
    We were unable to connect your call.
    Please try again later or contact MMD Delivery support.
  </Say>
</Response>
    `);
  } catch (error) {
    console.error("[twilio/voice] fatal error", error);
    return publicSupportDialAdmin();
  }
}