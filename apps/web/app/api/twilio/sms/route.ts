import type { NextRequest } from "next/server";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";

export const runtime = "nodejs";

function buildSmsTwiml() {
  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Welcome to MMD Delivery support. We received your message.</Message>
</Response>
  `.trim();
}

export async function GET() {
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  return new Response(buildSmsTwiml(), {
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

  return new Response(buildSmsTwiml(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}