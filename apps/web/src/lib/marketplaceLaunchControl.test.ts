import assert from "node:assert/strict";
import {
  extractMarketplaceLiveFields,
  isMarketplaceCheckoutLiveEnabledForConfig,
  isMarketplaceDispatchLiveEnabledForConfig,
  isMarketplacePayoutsLiveEnabledForConfig,
  sanitizePlatformLaunchMarketplaceFlags,
} from "./marketplaceLaunchControl";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const baseExisting = extractMarketplaceLiveFields({
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
});

test("live checkout defaults OFF without env", () => {
  assert.equal(isMarketplaceCheckoutLiveEnabledForConfig(baseExisting), false);
});

test("live checkout requires env AND admin flag AND checkout_enabled", () => {
  const prev = process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED;
  process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = "true";
  try {
    assert.equal(
      isMarketplaceCheckoutLiveEnabledForConfig({
        ...baseExisting,
        marketplace_checkout_live_enabled: true,
      }),
      true
    );
    assert.equal(
      isMarketplaceCheckoutLiveEnabledForConfig({
        ...baseExisting,
        marketplace_checkout_live_enabled: true,
        checkout_enabled: false,
      }),
      false
    );
  } finally {
    if (prev === undefined) delete process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED;
    else process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED = prev;
  }
});

test("sanitize cascades platform OFF to marketplace live flags", () => {
  const result = sanitizePlatformLaunchMarketplaceFlags(baseExisting, {
    platform_enabled: false,
    marketplace_checkout_live_enabled: true,
    marketplace_dispatch_live_enabled: true,
    marketplace_payouts_live_enabled: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.merged.marketplace_enabled, false);
    assert.equal(result.merged.marketplace_checkout_live_enabled, false);
    assert.equal(result.merged.marketplace_dispatch_live_enabled, false);
    assert.equal(result.merged.marketplace_payouts_live_enabled, false);
  }
});

test("sanitize rejects checkout live without checkout_enabled", () => {
  const result = sanitizePlatformLaunchMarketplaceFlags(
    { ...baseExisting, checkout_enabled: false },
    { marketplace_checkout_live_enabled: true }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "marketplace_checkout_live_requires_checkout_enabled");
  }
});

test("sanitize rejects payouts live without payout_enabled", () => {
  const result = sanitizePlatformLaunchMarketplaceFlags(
    { ...baseExisting, payout_enabled: false },
    { marketplace_payouts_live_enabled: true }
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "marketplace_payouts_live_requires_payout_enabled");
  }
});

test("dispatch live stays OFF by default", () => {
  assert.equal(isMarketplaceDispatchLiveEnabledForConfig(baseExisting), false);
});

test("payouts live stays OFF by default", () => {
  assert.equal(isMarketplacePayoutsLiveEnabledForConfig(baseExisting), false);
});

console.log("marketplaceLaunchControl tests passed");
