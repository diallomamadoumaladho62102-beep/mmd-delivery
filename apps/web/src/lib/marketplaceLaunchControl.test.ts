import assert from "node:assert/strict";
import {
  assertMarketplaceLiveMoneyAllowed,
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

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("live checkout defaults OFF without env", () => {
  assert.equal(isMarketplaceCheckoutLiveEnabledForConfig(baseExisting), false);
});

test("live money blocked until seller payouts E2E ready", () => {
  withEnv(
    {
      MARKETPLACE_SELLER_PAYOUTS_E2E_READY: undefined,
      MARKETPLACE_CHECKOUT_LIVE_ENABLED: "true",
      MARKETPLACE_DISPATCH_LIVE_ENABLED: "true",
      MARKETPLACE_PAYOUTS_LIVE_ENABLED: "true",
    },
    () => {
      assert.equal(assertMarketplaceLiveMoneyAllowed().ok, false);
      assert.equal(
        isMarketplaceCheckoutLiveEnabledForConfig({
          ...baseExisting,
          marketplace_checkout_live_enabled: true,
        }),
        false
      );
      assert.equal(
        isMarketplaceDispatchLiveEnabledForConfig({
          ...baseExisting,
          marketplace_dispatch_live_enabled: true,
        }),
        false
      );
      assert.equal(
        isMarketplacePayoutsLiveEnabledForConfig({
          ...baseExisting,
          marketplace_payouts_live_enabled: true,
        }),
        false
      );
    }
  );
});

test("sanitize refuses enabling live flags without E2E ready", () => {
  withEnv({ MARKETPLACE_SELLER_PAYOUTS_E2E_READY: undefined }, () => {
    const result = sanitizePlatformLaunchMarketplaceFlags(baseExisting, {
      marketplace_checkout_live_enabled: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "marketplace_seller_payouts_e2e_not_ready");
    }
  });
});

test("live checkout requires E2E + env AND admin flag AND checkout_enabled", () => {
  withEnv(
    {
      MARKETPLACE_SELLER_PAYOUTS_E2E_READY: "true",
      MARKETPLACE_CHECKOUT_LIVE_ENABLED: "true",
    },
    () => {
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
    }
  );
});

test("sanitize cascades platform OFF to marketplace live flags", () => {
  withEnv({ MARKETPLACE_SELLER_PAYOUTS_E2E_READY: "true" }, () => {
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
});

test("sanitize rejects checkout live without checkout_enabled", () => {
  withEnv({ MARKETPLACE_SELLER_PAYOUTS_E2E_READY: "true" }, () => {
    const result = sanitizePlatformLaunchMarketplaceFlags(
      { ...baseExisting, checkout_enabled: false },
      { marketplace_checkout_live_enabled: true }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "marketplace_checkout_live_requires_checkout_enabled");
    }
  });
});

test("sanitize rejects payouts live without payout_enabled", () => {
  withEnv({ MARKETPLACE_SELLER_PAYOUTS_E2E_READY: "true" }, () => {
    const result = sanitizePlatformLaunchMarketplaceFlags(
      { ...baseExisting, payout_enabled: false },
      { marketplace_payouts_live_enabled: true }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "marketplace_payouts_live_requires_payout_enabled");
    }
  });
});

test("dispatch live stays OFF by default", () => {
  assert.equal(isMarketplaceDispatchLiveEnabledForConfig(baseExisting), false);
});

test("payouts live stays OFF by default", () => {
  assert.equal(isMarketplacePayoutsLiveEnabledForConfig(baseExisting), false);
});

console.log("marketplaceLaunchControl tests passed");
