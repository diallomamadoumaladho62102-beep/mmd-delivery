import assert from "node:assert/strict";
import {
  driverBankPayoutIdempotencyKey,
  getNowPartsInTimeZone,
  isDriverBankPayoutWindow,
  resolveDriverBankPayoutWindow,
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

test("idempotency key is stable per account+ET date+window", () => {
  assert.equal(
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16"),
    "driver_sunday_bank_payout:acct_123:2026-08-16",
  );
  assert.equal(
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16", "catchup"),
    "driver_sunday_bank_payout_catchup:acct_123:2026-08-16",
  );
  assert.equal(
    sellerBankPayoutIdempotencyKey("acct_seller", "2026-08-16"),
    "seller_sunday_bank_payout:acct_seller:2026-08-16",
  );
  assert.notEqual(
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16", "primary"),
    driverBankPayoutIdempotencyKey("acct_123", "2026-08-16", "catchup"),
  );
});

test("window helper uses America/New_York parts — Sunday 4am + 4pm ET", () => {
  // Fixed instant: Sunday 2026-08-16 08:30 UTC = 04:30 EDT (UTC-4)
  const sun4edt = new Date("2026-08-16T08:30:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", sun4edt);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 4);
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);
  assert.equal(resolveDriverBankPayoutWindow(sun4edt).kind, "primary");

  // Same day 09:30 UTC = 05:30 EDT → outside window
  const sun5edt = new Date("2026-08-16T09:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5edt), false);

  // Catch-up: Sunday 20:30 UTC = 16:30 EDT
  const sun16edt = new Date("2026-08-16T20:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16edt), true);
  assert.equal(resolveDriverBankPayoutWindow(sun16edt).kind, "catchup");

  // Winter EST: Sunday 08:15 UTC = 03:15 EST → NOT 4am (must skip; GH fires 09:00 UTC instead)
  const sun3est = new Date("2026-01-11T08:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun3est), false);

  // Winter: Sunday 2026-01-11 09:15 UTC = 04:15 EST (UTC-5) → primary
  const sun4est = new Date("2026-01-11T09:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4est), true);
  assert.equal(resolveDriverBankPayoutWindow(sun4est).kind, "primary");

  // Winter catch-up: Sunday 21:15 UTC = 16:15 EST
  const sun16est = new Date("2026-01-11T21:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16est), true);
  assert.equal(resolveDriverBankPayoutWindow(sun16est).kind, "catchup");
});

test("Saturday 23:59 ET is not bank window; Sunday 04:00 and 16:00 ET are", () => {
  // Sat 2026-08-15 23:59 America/New_York (EDT) = 2026-08-16T03:59:00.000Z
  const sat2359et = new Date("2026-08-16T03:59:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sat2359et), false);

  // Sun 2026-08-16 00:01 EDT
  const sun0001et = new Date("2026-08-16T04:01:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun0001et), false);

  // Sun 2026-08-16 03:59 EDT → before primary
  const sun359et = new Date("2026-08-16T07:59:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun359et), false);

  // Sun 2026-08-16 04:00 EDT = 2026-08-16T08:00:00.000Z
  const sun4et = new Date("2026-08-16T08:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4et), true);

  // Sun 04:01 EDT still hour 4
  const sun401et = new Date("2026-08-16T08:01:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun401et), true);

  // Sun 05:00 EDT → outside
  const sun5et = new Date("2026-08-16T09:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5et), false);

  // Sun 10:00 EDT — available after primary, before catch-up (not a bank window)
  const sun10et = new Date("2026-08-16T14:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun10et), false);

  // Sun 16:00 EDT catch-up
  const sun16et = new Date("2026-08-16T20:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun16et), true);

  // Sun 16:01 still catch-up hour
  const sun1601et = new Date("2026-08-16T20:01:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun1601et), true);

  // Sun 17:00 → outside
  const sun17et = new Date("2026-08-16T21:00:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun17et), false);
});

console.log("driverConnectBankPayout tests passed");
