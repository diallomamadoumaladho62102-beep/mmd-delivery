#!/usr/bin/env node
/**
 * Verify local/Vercel payment provider env keys (presence only — never prints secrets).
 * Usage: node scripts/verify-payment-providers-env.mjs
 */
const KEYS = {
  stripe: ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  orange_money_gn: [
    "ORANGE_MONEY_GN_MERCHANT_KEY",
    "ORANGE_MONEY_GN_CLIENT_ID",
    "ORANGE_MONEY_GN_CLIENT_SECRET",
  ],
  paydunya: ["PAYDUNYA_MASTER_KEY", "PAYDUNYA_PRIVATE_KEY", "PAYDUNYA_TOKEN"],
  cinetpay: ["CINETPAY_API_KEY", "CINETPAY_SITE_ID"],
  flags: ["STRIPE_ENABLED_GN"],
};

const BASE = (
  process.env.PROD_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://www.mmddelivery.com"
).replace(/\/$/, "");

function present(name) {
  const value = String(process.env[name] ?? "").trim();
  return { name, present: Boolean(value), len: value.length };
}

const report = {
  checkedAt: new Date().toISOString(),
  publicBaseUrl: BASE,
  webhooks: {
    orange_money_gn: `${BASE}/api/payments/webhook/orange_money_gn`,
    paydunya: `${BASE}/api/payments/webhook/paydunya`,
    cinetpay: `${BASE}/api/payments/webhook/cinetpay`,
  },
  providers: Object.fromEntries(
    Object.entries(KEYS).map(([provider, keys]) => [
      provider,
      {
        keys: keys.map(present),
        configured: keys.every((key) => Boolean(String(process.env[key] ?? "").trim())),
      },
    ])
  ),
};

console.log(JSON.stringify(report, null, 2));

const missing = Object.entries(report.providers)
  .filter(([provider]) => provider !== "flags")
  .flatMap(([, value]) => value.keys.filter((key) => !key.present).map((key) => key.name));

process.exit(missing.length > 0 ? 1 : 0);
