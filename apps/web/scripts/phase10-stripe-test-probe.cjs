/**
 * Stripe Test-mode probe — creates and cancels a PaymentIntent.
 * Never prints secrets. Refuses Live keys.
 */
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = {
  ...loadEnv(path.join(__dirname, "..", ".env")),
  ...loadEnv(path.join(__dirname, "..", ".env.local")),
  ...process.env,
};

const key = String(env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("BLOCKED: STRIPE_SECRET_KEY absent");
  process.exit(2);
}
if (key.startsWith("sk_live")) {
  console.error("BLOCKED: Live Stripe key refused");
  process.exit(3);
}
if (!key.startsWith("sk_test")) {
  console.error("BLOCKED: STRIPE_SECRET_KEY is not sk_test_*");
  process.exit(4);
}

async function main() {
  const Stripe = require("stripe");
  const stripe = new Stripe(key, { apiVersion: "2023-10-16" });
  const pi = await stripe.paymentIntents.create({
    amount: 100,
    currency: "usd",
    payment_method_types: ["card"],
    metadata: { mmd_probe: "phase10_1", purpose: "test_only" },
  });
  console.log(`pi_created: id=${pi.id} livemode=${pi.livemode} status=${pi.status}`);
  if (pi.livemode === true) {
    console.error("FAIL: PaymentIntent created in live mode");
    process.exit(5);
  }
  const canceled = await stripe.paymentIntents.cancel(pi.id);
  console.log(`pi_canceled: id=${canceled.id} status=${canceled.status}`);
  console.log("stripe_test_probe: ok");
}

main().catch((e) => {
  console.error("stripe_test_probe: fail", e instanceof Error ? e.message : e);
  process.exit(1);
});
