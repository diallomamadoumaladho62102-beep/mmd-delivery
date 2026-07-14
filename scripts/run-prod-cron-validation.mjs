#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function loadEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1].trim()] = v;
  }
  return out;
}

const file = "apps/web/.env.vercel.production.local";
const envFile = loadEnv(file);
const stripe = String(envFile.STRIPE_SECRET_KEY || "").trim();
const cron = String(envFile.CRON_SECRET || "").trim();
const site = String(
  envFile.NEXT_PUBLIC_SITE_URL ||
    envFile.SITE_URL ||
    "https://www.mmddelivery.com"
).replace(/\/$/, "");

console.log(
  JSON.stringify({
    env_file_present: existsSync(file),
    cron_secret_present: Boolean(cron),
    cron_secret_length: cron.length,
    stripe_present: Boolean(stripe),
    stripe_length: stripe.length,
    stripe_live: stripe.startsWith("sk_live_"),
    stripe_test: stripe.startsWith("sk_test_"),
    site,
  })
);

const childEnv = {
  ...process.env,
  CRON_SECRET: cron,
  SITE_URL: site,
  PRODUCTION_SITE_URL: site,
};

const result = spawnSync(process.execPath, ["scripts/invoke-production-crons-once.mjs"], {
  cwd: process.cwd(),
  env: childEnv,
  encoding: "utf8",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
