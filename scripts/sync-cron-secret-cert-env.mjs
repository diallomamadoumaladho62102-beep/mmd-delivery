#!/usr/bin/env node
/**
 * Sync CRON_SECRET from process.env into gitignored final-certification.env.
 * Run inside: cd apps/web && npx vercel env run -e production -- node ../../scripts/sync-cron-secret-cert-env.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const certPath = join(root, "docs/production/final-certification.env");

const secret = String(process.env.CRON_SECRET ?? "").trim();
if (!secret || secret.length < 16) {
  console.error("CRON_SECRET missing or too short in runtime env");
  process.exit(1);
}

let cert = readFileSync(certPath, "utf8");
if (/^CRON_SECRET=/m.test(cert)) {
  cert = cert.replace(/^CRON_SECRET=.*$/m, `CRON_SECRET=${secret}`);
} else {
  cert += `\nCRON_SECRET=${secret}\n`;
}
writeFileSync(certPath, cert, "utf8");
console.log(`Synced CRON_SECRET to final-certification.env (len=${secret.length})`);
