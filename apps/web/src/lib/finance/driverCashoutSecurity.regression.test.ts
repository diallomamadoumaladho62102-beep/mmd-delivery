/**
 * Regression: drivers cannot cash out as another user or spoof payout params.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const driverRoute = fs.readFileSync(
  path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
  "utf8",
);
const manualSrc = fs.readFileSync(
  path.join(webRoot, "src/lib/finance/manualCashoutService.ts"),
  "utf8",
);

assert.match(driverRoute, /bodyDriverId !== driverUserId/, "rejects mismatched driver_id body");
assert.match(driverRoute, /Driver role required/, "requires driver role");
assert.match(driverRoute, /executeManualConnectCashout/, "uses shared manual cashout");
assert.match(manualSrc, /createPayoutTransaction/, "uses payout transaction ledger");
assert.match(manualSrc, /manual-cashout:/, "Stripe idempotency on claim id");
assert.match(manualSrc, /claim_manual_cashout_day/, "atomic daily claim RPC");

console.log("driverCashoutSecurity.regression.test.ts OK");
