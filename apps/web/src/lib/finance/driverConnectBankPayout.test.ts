import assert from "node:assert/strict";
import {
  driverBankPayoutIdempotencyKey,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
  sellerBankPayoutIdempotencyKey,
} from "./driverConnectBankPayout";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("idempotency key is stable per account+ET date", () => {
  assert.equal(
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16"),
    "driver_sunday_bank_payout:acct_123:2026-08-16",
  );
  assert.equal(
    sellerBankPayoutIdempotencyKey("acct_seller", "2026-08-16"),
    "seller_sunday_bank_payout:acct_seller:2026-08-16",
  );
  assert.doesNotMatch(
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16"),
    /catchup/,
  );
});

test("window helper uses America/New_York parts — exact Sunday 4am ET only", () => {
  const sun4edt = new Date("2026-08-16T08:30:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", sun4edt);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 4);
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);

  const sun5edt = new Date("2026-08-16T09:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5edt), false);

  // Sunday 16:00 ET is NOT a bank window (no catch-up)
  const sun16edt = new Date("2026-08-16T20:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16edt), false);

  const sun3est = new Date("2026-01-11T08:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun3est), false);

  const sun4est = new Date("2026-01-11T09:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4est), true);

  const sun16est = new Date("2026-01-11T21:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16est), false);
});

test("Saturday 23:59 ET is not bank window; Sunday 04:00 ET is; 16:00 is not", () => {
  const sat2359et = new Date("2026-08-16T03:59:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sat2359et), false);

  const sun0001et = new Date("2026-08-16T04:01:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun0001et), false);

  const sun359et = new Date("2026-08-16T07:59:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun359et), false);

  const sun4et = new Date("2026-08-16T08:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4et), true);

  const sun401et = new Date("2026-08-16T08:01:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun401et), true);

  const sun5et = new Date("2026-08-16T09:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5et), false);

  const sun10et = new Date("2026-08-16T14:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun10et), false);

  const sun16et = new Date("2026-08-16T20:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16et), false);
});

console.log("driverConnectBankPayout tests passed");
