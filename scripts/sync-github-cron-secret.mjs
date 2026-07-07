#!/usr/bin/env node
/**
 * Sync CRON_SECRET from the current process env to GitHub Actions repository secrets.
 *
 * Usage:
 *   cd apps/web && npx vercel env run -e production -- node ../../scripts/sync-github-cron-secret.mjs
 *   CRON_SECRET=... node scripts/sync-github-cron-secret.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";

const secret = String(process.env.CRON_SECRET ?? "").trim();
if (secret.length < 16) {
  console.error(
    "CRON_SECRET missing or too short in process env. Load it from Vercel production first.",
  );
  process.exit(1);
}

function ghAvailable() {
  const result = spawnSync("gh", ["auth", "status"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

if (!ghAvailable()) {
  console.error("GitHub CLI is not authenticated. Run: gh auth login");
  process.exit(1);
}

execFileSync(
  "gh",
  ["secret", "set", "CRON_SECRET", "--body", secret],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

console.log(`Synced CRON_SECRET to GitHub Actions (len=${secret.length}).`);
