import Stripe from "stripe";

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
const isVercelProduction =
  String(process.env.VERCEL_ENV ?? "").trim() === "production" ||
  String(process.env.NODE_ENV ?? "").trim() === "production";

if (
  isVercelProduction &&
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
