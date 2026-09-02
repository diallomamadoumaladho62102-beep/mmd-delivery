/**
 * Guard: no artificial MMD SCT hold by default (TAXI_PAYOUT_HOLD_HOURS → 0).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const taxiXfer = readFileSync(
  join(import.meta.dirname, "executeTaxiDriverFareTransfer.ts"),
  "utf8",
);
const taxiCron = readFileSync(
  join(import.meta.dirname, "../../../app/api/cron/taxi-payouts/route.ts"),
  "utf8",
);

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("taxi fare transfer defaults hold hours to 0", () => {
  assert.match(taxiXfer, /TAXI_PAYOUT_HOLD_HOURS\s*\?\?\s*0/);
  assert.match(taxiXfer, /Default 0:\s*immediate SCT/);
});

test("taxi-payouts cron defaults hold hours to 0", () => {
  assert.match(taxiCron, /DEFAULT_HOLD_HOURS\s*=\s*0/);
  assert.match(taxiCron, /Immediate SCT after complete/);
});

console.log("zeroMmdSctHold regression passed");
