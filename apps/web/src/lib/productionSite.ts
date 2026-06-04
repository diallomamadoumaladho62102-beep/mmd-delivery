/** Canonical public site origin (Stripe webhook, marketing, Supabase redirects). */
export const CANONICAL_SITE_ORIGIN = "https://www.mmddelivery.com";

/** Legacy Vercel deployment URL — keep in deep-link allowlists only. */
export const LEGACY_VERCEL_SITE_ORIGIN = "https://mmd-delivery.vercel.app";

export const RESET_PASSWORD_PATH = "/auth/reset-password";

export function getResetPasswordRedirectUrl(): string {
  return `${CANONICAL_SITE_ORIGIN}${RESET_PASSWORD_PATH}`;
}
