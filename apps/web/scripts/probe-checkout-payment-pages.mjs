#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.USERPROFILE || process.env.HOME || "";
const candidates = [
  join(home, ".config", "stripe", "config.toml"),
  join(home, "AppData", "Roaming", "stripe", "config.toml"),
];
const configPath = candidates.find((p) => existsSync(p));
if (!configPath) {
  console.log(JSON.stringify({ ok: false, error: "stripe_config_missing" }));
  process.exit(1);
}

const raw = readFileSync(configPath, "utf8");
const lines = raw.split(/\r?\n/);
const pkLine = lines.find((l) => /live_mode_pub_key/.test(l));
const pk = (pkLine || "").match(/['"]([^'"]+)['"]/)?.[1] || "";
const expiresLine = lines.find((l) => /live_mode_key_expires_at/.test(l));

console.log(
  JSON.stringify({
    config: configPath,
    pk_ok: pk.startsWith("pk_live_"),
    pk_len: pk.length,
    live_key_expires_line: expiresLine
      ? expiresLine.replace(/=\s*'[^']+'/, "=…")
      : null,
  }),
);

if (!pk.startsWith("pk_live_")) {
  process.exit(2);
}

const sessions = [
  "cs_live_b1gsgEoumcaMjfNO1JU9QPxdRwHQWfPfdvy8y3kDYqseWWh3D7Efv23GIH",
  "cs_live_b1T28pcPYWMg2FCKMh6uDPW2m8twYEGbnNAIlrZ5X3spBDEdU41HR3wle3",
];

for (const id of sessions) {
  const res = await fetch(`https://api.stripe.com/v1/payment_pages/${id}`, {
    headers: {
      Authorization: `Bearer ${pk}`,
      Accept: "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  console.log(
    JSON.stringify({
      id: `${id.slice(0, 10)}…${id.slice(-4)}`,
      http: res.status,
      err: json?.error?.message || null,
      code: json?.error?.code || null,
      object: json?.object || null,
      status: json?.status || null,
      payment_status: json?.payment_status || null,
      amount_total: json?.amount_total ?? null,
      currency: json?.currency || null,
      livemode: json?.livemode ?? null,
      expires_at: json?.expires_at
        ? new Date(json.expires_at * 1000).toISOString()
        : null,
      success_url: json?.success_url || null,
      cancel_url: json?.cancel_url || null,
      payment_method_types: json?.payment_method_types || null,
      payment_intent: json?.payment_intent
        ? `${String(json.payment_intent).slice(0, 10)}…`
        : null,
      customer: json?.customer ? `${String(json.customer).slice(0, 10)}…` : null,
      url: json?.url || null,
      keys: json && !json.error ? Object.keys(json).slice(0, 40) : null,
    }),
  );
}
