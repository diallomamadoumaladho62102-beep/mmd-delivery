import { resolveCcCapability, type CcCapabilityStatus } from "@/lib/adminFeatureFlags";

export type StaffCallProviderPlan = {
  capability: CcCapabilityStatus;
  canCreateLiveRoom: boolean;
  mode: "disabled" | "twilio_scheduled_only" | "twilio_live";
};

/**
 * Fail-closed call provider plan.
 * Live rooms require Twilio Video API key pair.
 * Without credentials, create/join live calls MUST fail — never fake success.
 */
export function getStaffCallProviderPlan(): StaffCallProviderPlan {
  const capability = resolveCcCapability("staffAudioVideoCalls");
  const hasApiKey =
    Boolean(String(process.env.TWILIO_API_KEY_SID ?? "").trim()) &&
    Boolean(String(process.env.TWILIO_API_KEY_SECRET ?? "").trim()) &&
    Boolean(String(process.env.TWILIO_ACCOUNT_SID ?? "").trim());

  if (!capability.enabled) {
    return {
      capability,
      canCreateLiveRoom: false,
      mode: "disabled",
    };
  }

  if (hasApiKey) {
    return {
      capability: { ...capability, provider: "twilio_video" },
      canCreateLiveRoom: true,
      mode: "twilio_live",
    };
  }

  // Auth token alone is not enough for Video Access Tokens — schedule only.
  return {
    capability: {
      enabled: true,
      provider: "twilio",
      reason:
        "TWILIO_API_KEY_SID/SECRET required for live rooms; scheduling allowed",
    },
    canCreateLiveRoom: false,
    mode: "twilio_scheduled_only",
  };
}

export async function createTwilioVideoRoom(roomName: string): Promise<{
  ok: boolean;
  sid?: string;
  error?: string;
}> {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const apiKey = String(process.env.TWILIO_API_KEY_SID ?? "").trim();
  const apiSecret = String(process.env.TWILIO_API_KEY_SECRET ?? "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN ?? "").trim();

  if (!accountSid || (!apiKey && !authToken)) {
    return { ok: false, error: "Twilio credentials missing" };
  }

  const auth =
    apiKey && apiSecret
      ? Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")
      : Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const body = new URLSearchParams({
      UniqueName: roomName,
      Type: "group",
      RecordParticipantsOnConnect: "false",
    });
    const res = await fetch(
      `https://video.twilio.com/v1/Rooms`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      code?: number;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.message ?? `Twilio room create failed (${res.status})`,
      };
    }
    return { ok: true, sid: data.sid };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Twilio request failed",
    };
  }
}
