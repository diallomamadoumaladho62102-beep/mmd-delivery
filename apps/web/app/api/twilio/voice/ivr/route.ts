import type { NextRequest } from "next/server";

import { handleTwilioVoiceIvr } from "@/lib/twilioVoiceIvr";
import { twilioVoiceSay } from "@/lib/twilioVoiceIncoming";

export const runtime = "nodejs";

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

  return twilioVoiceSay(
    "MMD Delivery voice IVR webhook (dev only). Use POST from Twilio.",
  );
}

export async function POST(req: NextRequest) {
  try {
    return await handleTwilioVoiceIvr(req);
  } catch (error) {
    console.error("[twilio/voice/ivr] fatal error", {
      path: "/api/twilio/voice/ivr",
      message: error instanceof Error ? error.message : "unknown",
    });
    return twilioVoiceSay(
      "Please stay on the line while we connect you to support.",
    );
  }
}
