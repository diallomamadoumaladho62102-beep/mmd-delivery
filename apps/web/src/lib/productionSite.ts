/** Canonical public site origin (Stripe return URLs, webhooks, marketing). */
export const CANONICAL_SITE_ORIGIN = "https://www.mmddelivery.com";

/** Legacy Vercel deployment URL — deep-link allowlists only; never Stripe return URLs. */
export const LEGACY_VERCEL_SITE_ORIGIN = "https://mmd-delivery.vercel.app";

export const RESET_PASSWORD_PATH = "/auth/reset-password";

export type PublicSiteEnv = {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  NEXT_PUBLIC_WEB_BASE_URL?: string;
  APP_BASE_URL?: string;
  SITE_URL?: string;
  APP_URL?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  STRIPE_CHECKOUT_SUCCESS_URL?: string;
  STRIPE_CHECKOUT_CANCEL_URL?: string;
  STRIPE_RETURN_URL?: string;
  STRIPE_REFRESH_URL?: string;
};

export class PublicSiteOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicSiteOriginError";
  }
}

function trimEnv(value: unknown): string {
  return String(value ?? "").trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Normalize a candidate absolute origin; returns "" if invalid. */
export function normalizePublicOrigin(value?: string | null): string {
  const raw = trimEnv(value);
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase();

    const allowHttp =
      parsed.protocol === "http:" &&
      (isLoopbackHost(hostname) || isPrivateIpv4(hostname));
    const allowHttps = parsed.protocol === "https:";

    if (!allowHttp && !allowHttps) return "";

    return stripTrailingSlash(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return "";
  }
}

export function isLegacyVercelOrigin(value?: string | null): boolean {
  const origin = normalizePublicOrigin(value);
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host === "mmd-delivery.vercel.app" ||
      host.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function firstConfiguredOrigin(
  env: PublicSiteEnv,
  keys: (keyof PublicSiteEnv)[],
): string {
  for (const key of keys) {
    const origin = normalizePublicOrigin(env[key]);
    if (origin) return origin;
  }
  return "";
}

export function getDeploymentSurface(
  env: PublicSiteEnv = process.env as PublicSiteEnv,
): "production" | "preview" | "local" {
  const vercelEnv = trimEnv(env.VERCEL_ENV).toLowerCase();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  if (vercelEnv === "development") return "local";

  const nodeEnv = trimEnv(env.NODE_ENV).toLowerCase();
  if (nodeEnv === "production") {
    // Non-Vercel production-like runtime (e.g. next start): treat as production
    // for fail-closed site URL resolution.
    return "production";
  }
  return "local";
}

/**
 * Resolve the public site origin for Stripe return URLs and public redirects.
 *
 * Rules:
 * - Production (VERCEL_ENV=production): always https://www.mmddelivery.com
 *   Never use VERCEL_URL / *.vercel.app as the public canonical domain.
 * - Preview: Preview deployment URL (VERCEL_URL / configured preview site URL).
 * - Local: localhost (or explicit local SITE_URL).
 * - Production without usable config (non-Vercel NODE_ENV=production and no
 *   explicit site URL vars): fail-closed.
 */
export function resolvePublicSiteOrigin(
  env: PublicSiteEnv = process.env as PublicSiteEnv,
): string {
  const surface = getDeploymentSurface(env);

  if (surface === "production") {
    const vercelEnv = trimEnv(env.VERCEL_ENV).toLowerCase();

    // Vercel Production runtime: always the customer-facing canonical domain.
    if (vercelEnv === "production") {
      return CANONICAL_SITE_ORIGIN;
    }

    // Non-Vercel production-like: require an explicit public site URL and
    // never accept VERCEL_URL / *.vercel.app as canonical.
    const explicit = firstConfiguredOrigin(env, [
      "NEXT_PUBLIC_WEB_BASE_URL",
      "NEXT_PUBLIC_SITE_URL",
      "APP_BASE_URL",
      "SITE_URL",
      "APP_URL",
    ]);

    if (!explicit) {
      throw new PublicSiteOriginError(
        "Missing public site base URL in production. Set NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_WEB_BASE_URL to https://www.mmddelivery.com.",
      );
    }

    if (isLegacyVercelOrigin(explicit)) {
      throw new PublicSiteOriginError(
        `Refusing legacy Vercel domain as public site origin in production: ${explicit}`,
      );
    }

    return explicit;
  }

  if (surface === "preview") {
    const preview = firstConfiguredOrigin(env, [
      "NEXT_PUBLIC_WEB_BASE_URL",
      "NEXT_PUBLIC_SITE_URL",
      "APP_BASE_URL",
      "SITE_URL",
      "APP_URL",
      "VERCEL_URL",
      "VERCEL_PROJECT_PRODUCTION_URL",
    ]);
    if (!preview) {
      throw new PublicSiteOriginError(
        "Missing preview site URL. Set NEXT_PUBLIC_SITE_URL or rely on VERCEL_URL.",
      );
    }
    return preview;
  }

  const local = firstConfiguredOrigin(env, [
    "NEXT_PUBLIC_WEB_BASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "APP_BASE_URL",
    "SITE_URL",
    "APP_URL",
  ]);
  if (local && !isLegacyVercelOrigin(local)) return local;
  return "http://localhost:3000";
}

function appendQuery(
  baseUrl: string,
  query?: Record<string, string | undefined | null>,
): string {
  const url = new URL(baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function normalizeAbsoluteHttpsOrLocalUrl(value?: string | null): string {
  const raw = trimEnv(value);
  if (!raw) return "";

  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase();
    const allowHttp =
      parsed.protocol === "http:" &&
      (isLoopbackHost(hostname) || isPrivateIpv4(hostname));
    const allowHttps = parsed.protocol === "https:";
    if (!allowHttp && !allowHttps) return "";
    return stripTrailingSlash(parsed.toString());
  } catch {
    return "";
  }
}

/**
 * Resolve an absolute Stripe return base URL.
 * Empty overrides fall through to `${origin}${fallbackPath}`.
 * In production, legacy *.vercel.app bases are rewritten to the canonical origin.
 */
export function resolveStripeReturnBaseUrl(params: {
  override?: string | null;
  fallbackPath: string;
  env?: PublicSiteEnv;
}): string {
  const env = params.env ?? (process.env as PublicSiteEnv);
  const origin = resolvePublicSiteOrigin(env);
  const surface = getDeploymentSurface(env);
  const fallback = `${origin}${
    params.fallbackPath.startsWith("/")
      ? params.fallbackPath
      : `/${params.fallbackPath}`
  }`;

  const override = normalizeAbsoluteHttpsOrLocalUrl(params.override);
  if (!override) return fallback;

  try {
    const parsed = new URL(override);
    if (surface === "production" && isLegacyVercelOrigin(parsed.origin)) {
      parsed.protocol = "https:";
      parsed.host = new URL(CANONICAL_SITE_ORIGIN).host;
      return stripTrailingSlash(parsed.toString());
    }
    return override;
  } catch {
    return fallback;
  }
}

export function buildStripeCheckoutReturnUrls(params: {
  successQuery?: Record<string, string | undefined | null>;
  cancelQuery?: Record<string, string | undefined | null>;
  successPath?: string;
  cancelPath?: string;
  env?: PublicSiteEnv;
}): { successUrl: string; cancelUrl: string; origin: string } {
  const env = params.env ?? (process.env as PublicSiteEnv);
  const origin = resolvePublicSiteOrigin(env);
  const successBase = resolveStripeReturnBaseUrl({
    override: env.STRIPE_CHECKOUT_SUCCESS_URL,
    fallbackPath: params.successPath ?? "/stripe/success",
    env,
  });
  const cancelBase = resolveStripeReturnBaseUrl({
    override: env.STRIPE_CHECKOUT_CANCEL_URL,
    fallbackPath: params.cancelPath ?? "/stripe/cancel",
    env,
  });

  return {
    origin,
    successUrl: appendQuery(successBase, params.successQuery),
    cancelUrl: appendQuery(cancelBase, params.cancelQuery),
  };
}

export function buildStripeConnectReturnUrls(
  env: PublicSiteEnv = process.env as PublicSiteEnv,
): { returnUrl: string; refreshUrl: string; origin: string } {
  const origin = resolvePublicSiteOrigin(env);
  const returnBase = resolveStripeReturnBaseUrl({
    override: env.STRIPE_RETURN_URL,
    fallbackPath: "/stripe/return",
    env,
  });
  const refreshBase = resolveStripeReturnBaseUrl({
    override: env.STRIPE_REFRESH_URL,
    fallbackPath: "/stripe/refresh",
    env,
  });
  return {
    origin,
    returnUrl: returnBase,
    refreshUrl: refreshBase,
  };
}

export function getResetPasswordRedirectUrl(
  env: PublicSiteEnv = process.env as PublicSiteEnv,
): string {
  try {
    return `${resolvePublicSiteOrigin(env)}${RESET_PASSWORD_PATH}`;
  } catch {
    return `${CANONICAL_SITE_ORIGIN}${RESET_PASSWORD_PATH}`;
  }
}
