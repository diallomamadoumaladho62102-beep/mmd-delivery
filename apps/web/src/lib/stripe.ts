import Stripe from "stripe";

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();

/**
 * Only Vercel Production runtime (`VERCEL_ENV=production`).
 * Do NOT use NODE_ENV: Next.js sets NODE_ENV=production for Preview builds too,
 * which previously made Dependabot/Preview deploys throw when STRIPE was sk_test.
 */
const isVercelProductionRuntime =
  String(process.env.VERCEL_ENV ?? "").trim() === "production";

if (
  isVercelProductionRuntime &&
  stripeSecretKey &&
  !stripeSecretKey.startsWith("sk_live_")
) {
  // Soft warning: Production is currently provisioned with sk_test for controlled
  // payment validation. Hard-failing here would 500 every Stripe import path.
  // Re-enable a hard throw when Live keys are restored on Vercel Production.
  console.error(
    "[MMD] WARNING: Vercel production STRIPE_SECRET_KEY is not sk_live_*. " +
      "Connect onboarding and bank flows will be TEST mode until Live keys are restored.",
  );
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2023-10-16",
});

export const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
