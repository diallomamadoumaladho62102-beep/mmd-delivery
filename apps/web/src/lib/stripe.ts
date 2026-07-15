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

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

export const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
