import assert from "node:assert/strict";
import { buildPlatformLaunchPatchUpdate } from "./adminPlatformLaunchPatch";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const existing = {
  platform_enabled: true,
  marketplace_enabled: true,
  seller_enabled: true,
  checkout_enabled: true,
  payout_enabled: true,
  maintenance_mode: false,
  launch_status: "enabled",
  marketplace_checkout_live_enabled: false,
  marketplace_dispatch_live_enabled: false,
  marketplace_payouts_live_enabled: false,
};

test("buildPlatformLaunchPatchUpdate enables marketplace visibility without live flags", () => {
  const result = buildPlatformLaunchPatchUpdate(existing, {
    marketplace_enabled: true,
    seller_enabled: true,
    marketplace_checkout_live_enabled: false,
    marketplace_dispatch_live_enabled: false,
    marketplace_payouts_live_enabled: false,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.update.marketplace_enabled, true);
    assert.equal(result.update.seller_enabled, true);
    assert.equal(result.update.marketplace_checkout_live_enabled, false);
    assert.equal(result.update.marketplace_payouts_live_enabled, false);
  }
});

test("buildPlatformLaunchPatchUpdate rejects invalid checkout live patch", () => {
  const result = buildPlatformLaunchPatchUpdate(
    { ...existing, checkout_enabled: false },
    { marketplace_checkout_live_enabled: true }
  );
  assert.equal(result.ok, false);
});

console.log("adminPlatformLaunchPatch tests passed");
