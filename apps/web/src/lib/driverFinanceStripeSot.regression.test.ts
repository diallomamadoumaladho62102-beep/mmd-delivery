import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("fare transfer persists transfer id as paid SoT", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/finance/executeTaxiDriverFareTransfer.ts"),
    "utf8",
  );
  assert.match(src, /driver_transfer_id/);
  assert.match(src, /Paid only when a non-reversed transfer id is persisted/);
  assert.match(src, /transfers\.create|stripe\.transfers/);
});

test("admin force complete reuses same SCT side effects", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "src/lib/taxiCompleteRideCore.ts"),
    "utf8",
  );
  assert.match(src, /ensureWorkerConnectCredit/);
  assert.match(src, /admin_force_complete/);
  assert.match(src, /bypassed_proximity/);
  assert.doesNotMatch(src, /\.rpc\(\s*["']driver_complete_taxi_ride["']/);
});

test("driver complete remains GPS gated", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/complete/route.ts"),
    "utf8",
  );
  assert.match(src, /assertTaxiDropoffProximity/);
  assert.doesNotMatch(src, /adminForceCompleteTaxiRide/);
});

console.log("driverFinanceStripeSot regression passed");
