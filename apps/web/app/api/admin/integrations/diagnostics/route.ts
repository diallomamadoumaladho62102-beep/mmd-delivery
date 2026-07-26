import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { getPublicMapboxToken } from "@/lib/mapboxToken";
import { getStaffCallProviderPlan } from "@/lib/staffCallsProvider";
import {
  twilioRestServerStatus,
  twilioVideoServerStatus,
} from "@/lib/staffTwilioAccessToken";
import { STAFF_ATTACHMENTS_BUCKET } from "@/lib/staffAttachmentSecurity";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Status = "present" | "missing" | "invalid";
type Ready = "ready" | "not ready";
type Enabled = "enabled" | "disabled";

function mapboxPublicStatus(): Status {
  const token = getPublicMapboxToken();
  if (!token) return "missing";
  if (token.startsWith("sk.")) return "invalid";
  if (token.length < 20) return "invalid";
  if (token.startsWith("pk.") || token.length >= 20) return "present";
  return "invalid";
}

function mapboxMobileStatus(): Status {
  // Server cannot read EXPO_PUBLIC_* from mobile builds; report from process if present
  // (local/dev) — never print value. Production mobile is configured via EAS.
  const expo = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "").trim();
  const easHint = String(process.env.EAS_EXPO_PUBLIC_MAPBOX_TOKEN_STATUS ?? "").trim();
  if (easHint === "present" || easHint === "missing" || easHint === "invalid") {
    return easHint;
  }
  if (!expo) return "missing";
  if (expo.startsWith("sk.")) return "invalid";
  if (expo.length < 20) return "invalid";
  return "present";
}

function neverExposeDownloadTokenToBrowser(): boolean {
  // Ensure RNMAPBOX / downloads token is not aliased into NEXT_PUBLIC
  const publicKeys = [
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
    process.env.NEXT_PUBLIC_RNMAPBOX_MAPS_DOWNLOAD_TOKEN,
    process.env.NEXT_PUBLIC_MAPBOX_DOWNLOADS_TOKEN,
  ];
  for (const v of publicKeys) {
    const s = String(v ?? "").trim();
    if (s.startsWith("sk.")) return false;
  }
  return true;
}

/**
 * Secure integrations diagnostic — statuses only, never key material.
 * GET /api/admin/integrations/diagnostics
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("hub.access", request);

    const mapboxWeb = mapboxPublicStatus();
    const mapboxMobile = mapboxMobileStatus();
    const twilioRest = twilioRestServerStatus();
    const twilioVideo = twilioVideoServerStatus();
    const plan = getStaffCallProviderPlan();
    const twilioClientSdk: Enabled = plan.canCreateLiveRoom
      ? "enabled"
      : "disabled";

    let mediaStorage: Ready = "not ready";
    try {
      const supabase = buildSupabaseAdminClient();
      const { data, error } = await supabase.storage.getBucket(
        STAFF_ATTACHMENTS_BUCKET
      );
      if (!error && data && data.public === false) {
        mediaStorage = "ready";
      } else if (!error && data && data.public === true) {
        mediaStorage = "not ready"; // must stay private
      }
    } catch {
      mediaStorage = "not ready";
    }

    return NextResponse.json({
      ok: true,
      diagnostics: {
        "Mapbox web": mapboxWeb,
        "Mapbox mobile": mapboxMobile,
        "Twilio REST (SMS/Voice/Rooms)": twilioRest,
        "Twilio Video server": twilioVideo,
        "Twilio client SDK": twilioClientSdk,
        "stockage multimédia": mediaStorage,
      },
      // Extra non-secret ops hints
      meta: {
        mapbox_download_token_browser_safe: neverExposeDownloadTokenToBrowser(),
        twilio_live_mode: plan.mode,
        twilio_capability_enabled: plan.capability.enabled,
        twilio_video_sdk_ready:
          "code complete; live join requires TWILIO_API_KEY_SID+SECRET",
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status }
    );
  }
}
