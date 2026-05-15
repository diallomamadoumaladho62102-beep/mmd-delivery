import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function twiml(xml: string) {
  return new Response(xml.trim(), {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

function say(message: string) {
  return twiml(`
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${escapeXml(message)}</Say>
</Response>
  `);
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  return say("MMD Delivery voice system is active.");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const from = String(formData.get("From") || "").trim();
    const callSid = String(formData.get("CallSid") || "").trim();

    if (!from) {
      return say("Missing caller number.");
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
      console.error("call_sessions lookup error", sessionError);
      return say("Unable to verify this call session.");
    }

    if (!session) {
      return say("No active call session found.");
    }

    const targetPhone = String(session.target_phone || "").trim();
    const proxyNumber = String(session.proxy_number || "").trim();

    if (!targetPhone || !proxyNumber) {
      return say("This call session is incomplete.");
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
  <Say voice="alice">
    This call may be recorded for safety and quality purposes.
  </Say>
  <Dial
    callerId="${escapeXml(proxyNumber)}"
    answerOnBridge="true"
    timeout="25"
    record="record-from-answer-dual"
  >
    <Number>${escapeXml(targetPhone)}</Number>
  </Dial>
</Response>
    `);
  } catch (error) {
    console.error("twilio voice webhook error", error);
    return say("Internal server error.");
  }
}