import {
  CANONICAL_SITE_ORIGIN,
  LEGACY_VERCEL_SITE_ORIGIN,
  normalizePublicOrigin,
} from "@/lib/productionSite";

const ALLOWED_APP_SCHEMES = new Set(["mmddelivery"]);

const ALLOWED_IDENTITY_PATHS = new Set([
  "/identity/return",
  "/identity/complete",
  "/driver/identity",
  "/restaurant/identity",
  "/seller/identity",
]);

function isAllowedHttpsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "www.mmddelivery.com" || host === "mmddelivery.com") return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "mmd-delivery.vercel.app") return true;
  if (host.endsWith(".vercel.app") && host.includes("mmd-delivery")) return true;
  return false;
}

/**
 * Allowlist for client-supplied return URLs (Stripe Identity, etc.).
 * Never accept javascript:, data:, or arbitrary https hosts.
 */
export function assertSafeAppReturnUrl(
  value: string | null | undefined
): { ok: true; url: string } | { ok: false; error: "invalid_return_url" } {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, error: "invalid_return_url" };
  if (raw.length > 500) return { ok: false, error: "invalid_return_url" };

  const lower = raw.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return { ok: false, error: "invalid_return_url" };
  }

  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw.includes("\\") || raw.includes("\0")) {
      return { ok: false, error: "invalid_return_url" };
    }
    return { ok: true, url: raw };
  }

  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol.replace(/:$/, "").toLowerCase();

    if (ALLOWED_APP_SCHEMES.has(protocol)) {
      const path = parsed.hostname
        ? `/${parsed.hostname}${parsed.pathname}`
        : parsed.pathname || "/";
      const normalizedPath = path.replace(/\/+$/, "") || "/";
      if (
        ALLOWED_IDENTITY_PATHS.has(normalizedPath) ||
        normalizedPath.startsWith("/identity/")
      ) {
        return { ok: true, url: raw };
      }
      return { ok: false, error: "invalid_return_url" };
    }

    if (protocol !== "https" && !(protocol === "http" && isAllowedHttpsHost(parsed.hostname))) {
      return { ok: false, error: "invalid_return_url" };
    }

    if (!isAllowedHttpsHost(parsed.hostname)) {
      return { ok: false, error: "invalid_return_url" };
    }

    const origin = normalizePublicOrigin(`${parsed.protocol}//${parsed.host}`);
    if (!origin) return { ok: false, error: "invalid_return_url" };

    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "invalid_return_url" };
  }
}

export function allowedIdentityReturnOrigins(): string[] {
  return [CANONICAL_SITE_ORIGIN, LEGACY_VERCEL_SITE_ORIGIN];
}
