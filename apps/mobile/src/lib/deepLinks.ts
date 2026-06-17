/** Canonical Expo scheme (matches app.config.ts `scheme`). */
export const CANONICAL_APP_SCHEME = "mmddelivery://";

/** Legacy scheme kept for older marketing / referral links. */
export const LEGACY_APP_SCHEME = "mmd://";

export {
  MOBILE_LINKING_SCREEN_PATHS,
  MOBILE_UNIVERSAL_LINK_PATHS,
  isAasaPathCovered,
} from "./deepLinkPaths";

/**
 * Normalizes legacy `mmd://` URLs to `mmddelivery://` for in-app handling.
 * Universal https links are unchanged.
 */
export function normalizeDeepLinkUrl(
  url: string | null | undefined,
): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;

  if (raw.toLowerCase().startsWith("mmd://")) {
    return raw.replace(/^mmd:\/\//i, "mmddelivery://");
  }

  return raw;
}

export function buildReferralDeepLink(code: string): string {
  const clean = String(code ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();

  return `${CANONICAL_APP_SCHEME}r/${clean}`;
}
