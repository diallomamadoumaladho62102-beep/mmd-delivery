/** Canonical https paths served by www.mmddelivery.com and declared in AASA. */
export const MOBILE_UNIVERSAL_LINK_PATHS = [
  "/r/*",
  "/auth/*",
  "/signup/*",
  "/reset-password",
  "/choose-role",
  "/orders/*",
  "/driver/*",
  "/client/*",
  "/restaurant/*",
] as const;

/** React Navigation linking paths (relative to web origin / custom scheme host). */
export const MOBILE_LINKING_SCREEN_PATHS = {
  ResetPassword: "auth/reset-password",
  ClientAuth: "signup/client",
  DriverAuth: "signup/driver",
  RestaurantAuth: "signup/restaurant",
} as const;

export function isAasaPathCovered(linkingPath: string): boolean {
  const normalized = `/${String(linkingPath ?? "").replace(/^\/+/, "")}`;

  return MOBILE_UNIVERSAL_LINK_PATHS.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      return normalized.startsWith(prefix);
    }
    return normalized === pattern;
  });
}
