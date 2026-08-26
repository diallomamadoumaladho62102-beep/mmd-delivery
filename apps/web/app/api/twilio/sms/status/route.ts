import type { NextRequest } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const twilioParams = await formDataToParamRecord(formData);
  const twilioAuth = await assertTwilioWebhookRequest(req, twilioParams);

  if (twilioAuth.ok === false) {
    return new Response(twilioAuth.message, { status: twilioAuth.status });
  }

  const sid = String(twilioParams.MessageSid ?? twilioParams.SmsSid ?? "").trim();
  const status = String(twilioParams.MessageStatus ?? twilioParams.SmsStatus ?? "")
    .trim()
    .toLowerCase();

  if (!sid || !status) {
    return new Response("ok", { status: 200 });
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "delivered") patch.delivered_at = now;
  if (status === "sent") patch.sent_at = now;
  if (status === "failed" || status === "undelivered") {
    patch.failed_at = now;
    patch.failure_reason = String(
      twilioParams.ErrorMessage ?? twilioParams.ErrorCode ?? status,
    );
  }

  const supabase = buildSupabaseAdminClient();
  await supabase
    .from("sms_message_logs")
    .update(patch)
    .eq("twilio_message_sid", sid);

  return new Response("ok", { status: 200 });
}
