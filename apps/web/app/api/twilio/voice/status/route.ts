import type { NextRequest } from "next/server";

import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyTwilioStatusCallback } from "@/lib/twilioCallStatusService";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";

export const runtime = "nodejs";

function emptyTwilioResponse() {
  return new Response("", { status: 200 });
}

export async function GET() {
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  ) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  return emptyTwilioResponse();
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

    const callSid = String(
      formData.get("CallSid") ?? formData.get("ParentCallSid") ?? "",
    ).trim();
    const dialCallSid = String(formData.get("DialCallSid") ?? "").trim();
    const callStatus = String(
      formData.get("CallStatus") ?? formData.get("DialCallStatus") ?? "",
    ).trim();
    const fromPhone = String(formData.get("From") ?? "").trim();
    const toPhone = String(formData.get("To") ?? "").trim();
    const durationRaw = String(formData.get("CallDuration") ?? "").trim();
    const durationSeconds = Number.parseInt(durationRaw, 10);
    const errorCode = String(
      formData.get("ErrorCode") ?? formData.get("SipResponseCode") ?? "",
    ).trim();

    const payload = Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => [
        key,
        String(value ?? ""),
      ]),
    );

    await applyTwilioStatusCallback({
      supabaseAdmin,
      input: {
        callSid,
        dialCallSid,
        callStatus,
        fromPhone,
        toPhone,
        durationSeconds: Number.isFinite(durationSeconds)
          ? durationSeconds
          : null,
        errorCode: errorCode || null,
        payload,
      },
    });

    return emptyTwilioResponse();
  } catch (error) {
    console.error("[twilio/voice/status] fatal", {
      path: "/api/twilio/voice/status",
      message: error instanceof Error ? error.message : "unknown",
    });
    return emptyTwilioResponse();
  }
}
