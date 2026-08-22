import Stripe from "stripe";

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();

/**
 * Only Vercel Production runtime (`VERCEL_ENV=production`).
 * Do NOT use NODE_ENV: Next.js sets NODE_ENV=production for Preview builds too,
 * which previously made Preview deploys throw when a sk_test key was present.
 */
const isVercelProductionRuntime =
  String(process.env.VERCEL_ENV ?? "").trim() === "production";

if (
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

export const stripe = new Stripe(stripeSecretKey, {
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
