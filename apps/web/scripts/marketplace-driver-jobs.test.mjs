/**
 * Static checks for marketplace driver jobs service wiring.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..", "..");

const service = fs.readFileSync(
  path.join(repoRoot, "apps/web/src/lib/marketplaceDriverJobsService.ts"),
  "utf8"
);
assert.match(service, /dispatch_ready/);
assert.match(service, /assertApprovedDriver/);
assert.match(service, /marketplace_available/);

const route = fs.readFileSync(
  path.join(repoRoot, "apps/web/app/api/driver/marketplace-jobs/route.ts"),
  "utf8"
);
assert.match(route, /listMarketplaceJobsForDriver/);

console.log("marketplace-driver-jobs.test.mjs ALL PASS");
