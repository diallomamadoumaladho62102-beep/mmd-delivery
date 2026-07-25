/**
 * Control Center enterprise capabilities — fail-closed.
 * Runtime checks decide whether a surface is operational.
 * Never report success when a provider/credential is missing.
 */

export type CcCapability =
  | "liveMapboxOpsMap"
  | "staffRealtimeComms"
  | "staffAudioVideoCalls"
  | "staffGeoScopesUi"
  | "staffPerformanceMetrics"
  | "staffPresenceRealtime"
  | "headerNotificationsFeed";

export type CcCapabilityStatus = {
  enabled: boolean;
  reason?: string;
  provider?: string;
};

function hasEnv(...keys: string[]): boolean {
  return keys.every((k) => Boolean(String(process.env[k] ?? "").trim()));
}

function hasPublicMapbox(): boolean {
  return Boolean(
    String(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim() ||
      String(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "").trim()
  );
}

/** Server-side capability resolution. */
export function resolveCcCapability(flag: CcCapability): CcCapabilityStatus {
  switch (flag) {
    case "liveMapboxOpsMap":
      return hasPublicMapbox()
        ? { enabled: true, provider: "mapbox" }
        : {
            enabled: false,
            reason: "NEXT_PUBLIC_MAPBOX_TOKEN missing",
            provider: "mapbox",
          };
    case "staffRealtimeComms":
      // Uses Supabase Realtime + staff_* tables (no third-party chat vendor).
      return { enabled: true, provider: "supabase_realtime" };
    case "staffAudioVideoCalls": {
      const twilioVideo =
        hasEnv("TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET") ||
        hasEnv("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN");
      if (twilioVideo) {
        return { enabled: true, provider: "twilio" };
      }
      return {
        enabled: false,
        reason:
          "Twilio Video/Voice credentials missing (TWILIO_ACCOUNT_SID + API key or AUTH_TOKEN)",
        provider: "twilio",
      };
    }
    case "staffGeoScopesUi":
    case "staffPerformanceMetrics":
    case "staffPresenceRealtime":
    case "headerNotificationsFeed":
      return { enabled: true, provider: "internal" };
    default:
      return { enabled: false, reason: "unknown capability" };
  }
}

/** Client-safe snapshot (public env only for Mapbox; calls probed via API). */
export function resolveCcCapabilityClient(flag: CcCapability): CcCapabilityStatus {
  if (flag === "liveMapboxOpsMap") {
    return hasPublicMapbox()
      ? { enabled: true, provider: "mapbox" }
      : {
          enabled: false,
          reason: "NEXT_PUBLIC_MAPBOX_TOKEN missing",
          provider: "mapbox",
        };
  }
  if (flag === "staffAudioVideoCalls") {
    // Client must not assume secrets; wait for /api/admin/staff/calls/capability.
    return {
      enabled: false,
      reason: "Probe /api/admin/staff/calls/capability",
      provider: "twilio",
    };
  }
  return resolveCcCapability(flag);
}

/** @deprecated use resolveCcCapability — kept for gradual migration */
export const CC_FEATURE_FLAGS = {
  liveMapboxOpsMap: true,
  staffRealtimeComms: true,
  staffAudioVideoCalls: true,
  staffGeoScopesUi: true,
  staffPerformanceMetrics: true,
  staffPresenceRealtime: true,
  headerNotificationsFeed: true,
} as const;

export type CcFeatureFlag = keyof typeof CC_FEATURE_FLAGS;

export function isCcFeatureEnabled(flag: CcFeatureFlag): boolean {
  return resolveCcCapabilityClient(flag).enabled;
}
