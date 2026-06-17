/** Canonical public site + API origin for production mobile builds. */
export const CANONICAL_SITE_ORIGIN = "https://www.mmddelivery.com";

/** Legacy Vercel URL — deep links / AppNavigator prefixes only. */
export const LEGACY_VERCEL_SITE_ORIGIN = "https://mmd-delivery.vercel.app";

export const RESET_PASSWORD_PATH = "/auth/reset-password";

export const MOBILE_SIGNUP_PATHS = {
  client: "/signup/client",
  driver: "/signup/driver",
  restaurant: "/signup/restaurant",
} as const;

export function getResetPasswordRedirectUrl(): string {
  return `${CANONICAL_SITE_ORIGIN}${RESET_PASSWORD_PATH}`;
}
