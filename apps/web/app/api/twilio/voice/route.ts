import type { NextRequest } from "next/server";

import { handleTwilioVoiceIncoming, twilioVoiceSay } from "@/lib/twilioVoiceIncoming";

export const runtime = "nodejs";

/** @deprecated Prefer /api/twilio/voice/incoming — kept for backward compatibility. */
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
    "MMD Delivery voice webhook (legacy path). Configure Twilio to POST /api/twilio/voice/incoming.",
  );
}

/** @deprecated Prefer /api/twilio/voice/incoming — kept for backward compatibility. */
export async function POST(req: NextRequest) {
  try {
    return await handleTwilioVoiceIncoming(req);
  } catch (error) {
    console.error("[twilio/voice] fatal error", error);
    return twilioVoiceSay(
      "We are unable to process your call right now. Please try again later.",
    );
  }
}
