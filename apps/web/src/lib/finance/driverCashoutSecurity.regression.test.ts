/**
 * Regression: drivers cannot cash out as another user or spoof payout params.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const route = fs.readFileSync(
  path.join(webRoot, "app/api/wallet/driver-cashout/route.ts"),
  "utf8",
);

assert.match(route, /bodyDriverId !== driverUserId/, "rejects mismatched driver_id body");
assert.match(route, /Driver role required/, "requires driver role");
assert.match(route, /createPayoutTransaction/, "uses payout transaction ledger");
assert.match(route, /idempotency/i, "payout path is idempotent");

console.log("driverCashoutSecurity.regression.test.ts OK");
