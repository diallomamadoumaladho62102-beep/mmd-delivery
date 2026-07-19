#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.USERPROFILE || process.env.HOME || "";
const configPath = [
  join(home, ".config", "stripe", "config.toml"),
  join(home, "AppData", "Roaming", "stripe", "config.toml"),
].find((p) => existsSync(p));
const pk =
  (readFileSync(configPath, "utf8")
    .split(/\r?\n/)
    .find((l) => /live_mode_pub_key/.test(l)) || "").match(/['"]([^'"]+)['"]/)?.[1] ||
  "";

const prep = JSON.parse(
  readFileSync(
    join(process.cwd(), "apps/web/.tmp/live-food-e2e-prep.json"),
    "utf8",
  ),
);
const sessionId = String(prep.stripe.checkout_url || "").match(
  /(cs_live_[A-Za-z0-9]+)/,
)?.[1];
if (!sessionId) {
  console.log(JSON.stringify({ ok: false, error: "session_id_missing" }));
  process.exit(1);
}

const res = await fetch(`https://api.stripe.com/v1/payment_pages/${sessionId}`, {
  headers: { Authorization: `Bearer ${pk}`, Accept: "application/json" },
});
const json = await res.json();
const success = String(json.success_url || "");
const cancel = String(json.cancel_url || "");
const checks = {
  status_open: json.status === "open",
  payment_status_unpaid: json.payment_status === "unpaid",
  livemode: json.livemode === true,
  amount_total_1397: Number(json.total_summary?.total) === 1397,
  currency_usd: String(json.currency || "").toLowerCase() === "usd",
  success_www: success.startsWith("https://www.mmddelivery.com/"),
  cancel_www: cancel.startsWith("https://www.mmddelivery.com/"),
  not_vercel_app: !success.includes("vercel.app") && !cancel.includes("vercel.app"),
};

const ok = Object.values(checks).every(Boolean);
const hosted = json.stripe_hosted_url || json.url || null;

console.log(
  JSON.stringify(
    {
      ok,
      session_masked: `${sessionId.slice(0, 10)}…${sessionId.slice(-4)}`,
      checks,
      status: json.status,
      payment_status: json.payment_status,
      livemode: json.livemode,
      amount_total: json.total_summary?.total ?? null,
      currency: json.currency,
      success_url: success,
      cancel_url: cancel,
      checkout_url: hosted,
    },
    null,
    2,
  ),
);

if (!ok) process.exit(2);
