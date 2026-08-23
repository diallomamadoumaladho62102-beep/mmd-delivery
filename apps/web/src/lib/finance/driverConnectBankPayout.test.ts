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
});

test("window helper uses America/New_York parts — exact Sunday 4am ET only", () => {
  // Fixed instant: Sunday 2026-08-16 08:30 UTC = 04:30 EDT (UTC-4)
  const sun4edt = new Date("2026-08-16T08:30:00.000Z");
  const parts = getNowPartsInTimeZone("America/New_York", sun4edt);
  assert.equal(parts.weekday, "Sun");
  assert.equal(parts.hour, 4);
  assert.equal(isDriverBankPayoutWindow(sun4edt), true);

  // Same day 09:30 UTC = 05:30 EDT → outside window
  const sun5edt = new Date("2026-08-16T09:30:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun5edt), false);

  // Winter EST: Sunday 08:15 UTC = 03:15 EST → NOT 4am (must skip; GH fires 09:00 UTC instead)
  const sun3est = new Date("2026-01-11T08:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun3est), false);

  // Winter: Sunday 2026-01-11 09:15 UTC = 04:15 EST (UTC-5) → exact target
  const sun4est = new Date("2026-01-11T09:15:00.000Z");
  assert.equal(isDriverBankPayoutWindow(sun4est), true);
});

console.log("driverConnectBankPayout tests passed");
