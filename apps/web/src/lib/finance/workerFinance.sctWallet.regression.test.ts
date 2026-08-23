/**
 * Proves ensureWorkerConnectCredit is the SCT dispatcher and wallet summary uses one façade.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  describeWorkerConnectCredit,
} from "./ensureWorkerConnectCredit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../../..");

test("describeWorkerConnectCredit uses transfer:order:target idempotency hints", () => {
  const food = describeWorkerConnectCredit({
    vertical: "food",
    orderId: "ord_1",
    target: "driver",
  });
  assert.equal(food.idempotencyHint, "transfer:ord_1:driver");
  assert.equal(food.moneyOutEngine, "workerFinance");
});

test("taxiCompleteRideCore routes SCT through ensureWorkerConnectCredit", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/taxiCompleteRideCore.ts"),
    "utf8",
  );
  assert.match(src, /ensureWorkerConnectCredit/);
  assert.doesNotMatch(src, /executeTaxiDriverFareTransfer\s*\(/);
});

test("wallet summary route uses workerWalletSummary façade", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/wallet/summary/route.ts"),
    "utf8",
  );
  assert.match(src, /buildWorkerWalletSummary/);
  assert.match(src, /from "@\/lib\/finance\/workerWalletSummary"/);
  assert.doesNotMatch(src, /from "@\/lib\/driverWalletService"/);
  assert.doesNotMatch(src, /from "@\/lib\/finance\/unifiedWalletSummary"/);
});

test("process-payouts uses shared orderConnectTransferClient", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/admin/process-payouts/route.ts"),
    "utf8",
  );
  assert.match(src, /invokeOrderConnectTransfer/);
  assert.match(src, /orderConnectTransferClient/);
});

test("ensureWorkerConnectCredit is a real dispatcher (not describe-only stub)", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/ensureWorkerConnectCredit.ts"),
    "utf8",
  );
  assert.match(src, /executeTaxiDriverFareTransfer/);
  assert.match(src, /invokeOrderConnectTransfer/);
  assert.match(src, /executeMarketplacePayouts/);
  assert.doesNotMatch(
    src,
    /return \{ ok: true, description: describeWorkerConnectCredit\(ref\) \}/,
  );
});

console.log("workerFinance.sctWallet.regression.test.ts: ok");
