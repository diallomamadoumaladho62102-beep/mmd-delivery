import Stripe from "stripe";

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();

/**
 * Only true Vercel Production **runtime** (not local `next build` with production-like env).
 * Requires VERCEL=1 so `.env.production.local` with VERCEL_ENV=production + sk_test_
 * does not break local/CI builds. Preview uses VERCEL_ENV=preview.
 */
const isVercelProductionRuntime =
  process.env.VERCEL === "1" &&
  String(process.env.VERCEL_ENV ?? "").trim() === "production";

/** Next.js imports API routes during `collect page data`; skip key-mode throws then. */
const isStripeKeyModeGuardActive =
  process.env.NEXT_PHASE !== "phase-production-build";

if (
  isStripeKeyModeGuardActive &&
  isVercelProductionRuntime &&
  stripeSecretKey &&
  !stripeSecretKey.startsWith("sk_live_")
) {
  throw new Error(
    "[MMD] Production requires STRIPE_SECRET_KEY=sk_live_*. " +
      "A sk_test_ key would create test-mode Connect accounts and TEST BANK onboarding.",
  );
}

// Phase 10: never allow Live Stripe secrets on Preview/local (prevents real charges).
if (
  isStripeKeyModeGuardActive &&
  !isVercelProductionRuntime &&
  stripeSecretKey &&
  stripeSecretKey.startsWith("sk_live_")
) {
  throw new Error(
    "[MMD] Non-production forbids STRIPE_SECRET_KEY=sk_live_*. " +
      "Use sk_test_* on Preview/local. Live keys require VERCEL_ENV=production.",
  );
}

/** Pinned Stripe API version (runtime). Cast preserves TS when Dependabot bumps stripe major. */
export const STRIPE_API_VERSION =
  "2023-10-16" as unknown as Stripe.LatestApiVersion;

/**
 * Stripe Node SDK ≥22 throws when constructed with an empty apiKey.
 * Next.js `collect page data` imports this module at build time without secrets
 * (Dependabot / Preview builds). Use a non-empty placeholder only when no key
 * is present; real requests still fail auth until STRIPE_SECRET_KEY is set.
 */
const stripeClientKey =
  stripeSecretKey || "sk_test_mmd_build_placeholder_do_not_charge";

export const stripe = new Stripe(stripeClientKey, {
  apiVersion: STRIPE_API_VERSION,
});

export const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

/** Platform Connect account id (`acct_*`). Required for Stripe Node SDK ≥22 when retrieving payout schedule. */
export function resolveStripePlatformAccountId(): string | null {
  const id = String(process.env.STRIPE_PLATFORM_ACCOUNT_ID ?? "").trim();
  return id.startsWith("acct_") ? id : null;
}

/**
 * Retrieve the platform Stripe account (payout schedule, settings).
 * Stripe Node SDK <22 allowed omitting the id with a platform secret key; SDK 22+ requires `acct_*`.
 */
export async function retrievePlatformStripeAccount(
  client: Stripe = stripe,
  explicitId?: string,
): Promise<Stripe.Account> {
  const accountId = (explicitId ?? resolveStripePlatformAccountId() ?? "").trim();
  if (accountId.startsWith("acct_")) {
    return client.accounts.retrieve(accountId);
  }
  const retrieveLegacy = client.accounts.retrieve.bind(client.accounts) as (
    account?: string,
    ...rest: unknown[]
  ) => Promise<Stripe.Account>;
  return retrieveLegacy();
}

/** Stripe webhook verification payload compatible across stripe Node SDK majors. */
export function stripeWebhookPayload(rawBody: Buffer): string {
  return rawBody.toString("utf8");
}

export function stripeConnectRequestOptions(
  stripeAccountId: string,
  extra?: Stripe.RequestOptions,
): Stripe.RequestOptions {
  const id = String(stripeAccountId ?? "").trim();
  if (!id.startsWith("acct_")) {
    throw new Error("invalid_stripe_connect_account_id");
  }
  return { ...extra, stripeAccount: id };
}

/** Connect balance retrieve — `stripeAccount` belongs in RequestOptions for Stripe SDK 22+. */
export async function retrieveConnectBalance(
  stripeAccountId: string,
  client: Stripe = stripe,
): Promise<Stripe.Balance> {
  return client.balance.retrieve(
    {},
    stripeConnectRequestOptions(stripeAccountId),
  );
}
