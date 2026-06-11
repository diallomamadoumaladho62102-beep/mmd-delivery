/**
 * Smoke — Marketplace shadow (draft, RLS hardening, no Stripe/dispatch/payout)
 * Run: npm run test:marketplace-shadow
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");

const res = spawnSync(
  "npx",
  ["tsx", "src/lib/marketplaceShadowSmoke.integration.ts"],
  {
    cwd: webRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: true,
  }
);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}
