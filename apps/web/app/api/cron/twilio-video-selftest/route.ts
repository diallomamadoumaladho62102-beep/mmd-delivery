import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import {
  completeTwilioVideoRoom,
  createTwilioVideoRoom,
  getStaffCallProviderPlan,
} from "@/lib/staffCallsProvider";
import {
  buildStaffVideoIdentity,
  hasTwilioVideoApiKeys,
  mintStaffVideoAccessToken,
  twilioRestServerStatus,
  twilioVideoServerStatus,
} from "@/lib/staffTwilioAccessToken";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Secure Twilio Video self-test (CRON_SECRET).
 * Never returns tokens, secrets, or room SIDs in full — statuses only.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const plan = getStaffCallProviderPlan();
  const rest = twilioRestServerStatus();
  const videoKeys = twilioVideoServerStatus();

  if (!hasTwilioVideoApiKeys() || videoKeys !== "present") {
    return NextResponse.json({
      ok: false,
      blocked: "BLOCKED BY MISSING API KEY",
      diagnostics: {
        twilio_rest: rest,
        twilio_video_keys: videoKeys,
        canCreateLiveRoom: plan.canCreateLiveRoom,
        mode: plan.mode,
      },
    });
  }

  const roomName = `mmd-selftest-${Date.now()}`;
  const room = await createTwilioVideoRoom(roomName);
  if (!room.ok || !room.sid) {
    return NextResponse.json({
      ok: false,
      step: "create_room",
      error: "room_create_failed",
      // never echo Twilio message that might leak account info beyond status
      http_hint: room.error ? "twilio_error" : "unknown",
    });
  }

  const identityA = buildStaffVideoIdentity(
    "00000000-0000-4000-8000-0000000000aa"
  );
  const identityB = buildStaffVideoIdentity(
    "00000000-0000-4000-8000-0000000000bb"
  );
  const tokenA = mintStaffVideoAccessToken({
    identity: identityA,
    roomName,
  });
  const tokenB = mintStaffVideoAccessToken({
    identity: identityB,
    roomName,
  });

  const jwtShapeOk = (jwt: string) => {
    const parts = jwt.split(".");
    return parts.length === 3 && parts.every((p) => p.length > 10);
  };

  const tokensOk =
    tokenA.ok &&
    tokenB.ok &&
    jwtShapeOk(tokenA.ok ? tokenA.token : "") &&
    jwtShapeOk(tokenB.ok ? tokenB.token : "") &&
    (tokenA.ok ? tokenA.identity : "") !== (tokenB.ok ? tokenB.identity : "");

  // Ensure tokens are distinct and never returned
  const tokensDistinct =
    tokenA.ok &&
    tokenB.ok &&
    tokenA.token !== tokenB.token;

  const completed = await completeTwilioVideoRoom(room.sid);

  return NextResponse.json({
    ok: Boolean(tokensOk && tokensDistinct && completed.ok),
    diagnostics: {
      twilio_rest: rest,
      twilio_video_keys: videoKeys,
      canCreateLiveRoom: plan.canCreateLiveRoom,
      mode: plan.mode,
      room_create: room.ok ? "ok" : "failed",
      access_token_a: tokenA.ok ? "ok" : "failed",
      access_token_b: tokenB.ok ? "ok" : "failed",
      tokens_distinct: tokensDistinct ? "ok" : "failed",
      jwt_shape: tokensOk ? "ok" : "failed",
      room_complete: completed.ok ? "ok" : "failed",
      browser_receives_secret: "no",
      client_receives: "temporary_access_token_only",
    },
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
