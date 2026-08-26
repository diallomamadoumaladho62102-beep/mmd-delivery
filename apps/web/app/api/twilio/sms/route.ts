import type { NextRequest } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";
import { buildSmsTwiml, handleInboundSmsBody } from "@/lib/twilioSmsInbound";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  return new Response(buildSmsTwiml(null), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const twilioParams = await formDataToParamRecord(formData);
  const twilioAuth = await assertTwilioWebhookRequest(req, twilioParams);

  if (twilioAuth.ok === false) {
    return new Response(twilioAuth.message, { status: twilioAuth.status });
  }

  const from = String(twilioParams.From ?? twilioParams.from ?? "").trim();
  const body = String(twilioParams.Body ?? twilioParams.body ?? "");
  const supabase = buildSupabaseAdminClient();
  const handled = await handleInboundSmsBody({ supabase, from, body });

  return new Response(handled.twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
