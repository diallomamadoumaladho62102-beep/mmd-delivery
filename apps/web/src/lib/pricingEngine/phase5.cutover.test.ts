/**
 * Phase 5 — Marketplace cutover tests (no Stripe).
 * Canary is deterministic. Other verticals unchanged by this suite.
 */
import assert from "node:assert/strict";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "./flags";
import {
  isKillSwitchActive,
  resolveChargePathForPhase,
} from "./killSwitch";
import { canaryBucket, isInCanaryBucket } from "./canary";
import { selectMarketplaceChargePath } from "./charge/selectMarketplaceChargePath";
import {
  getCutoverMetricsSnapshot,
  resetCutoverMetricsForTests,
} from "./cutoverMetrics";
import {
  clearRememberedQuoteSnapshotsForTests,
  getRememberedQuoteSnapshots,
} from "./snapshot/foodPackageSnapshot";
import type { PricingEngineFlags } from "./flagTypes";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);

const defaults = resolvePricingEngineFlags({});
assert.equal(resolveChargePath(defaults, "marketplace"), "legacy");

const mktOn: PricingEngineFlags = {
  shadowEnabled: true,
  canaryPct: 100,
  serviceEnabled: {
    ride: false,
    food: false,
    package: false,
    marketplace: true,
  },
  killSwitch: false,
};

assert.equal(
  resolveChargePath(mktOn, "marketplace", { canaryKey: "user-a" }),
  "engine"
);
assert.equal(resolveChargePath(mktOn, "ride", { canaryKey: "user-a" }), "legacy");
assert.equal(resolveChargePath(mktOn, "food", { canaryKey: "user-a" }), "legacy");

// Phase 4 hard-scope: marketplace still legacy
assert.equal(
  resolveChargePathForPhase(mktOn, "marketplace", 4, { canaryKey: "x" }),
  "legacy"
);
assert.equal(
  resolveChargePathForPhase(mktOn, "marketplace", 5, { canaryKey: "x" }),
  "engine"
);

const killed: PricingEngineFlags = { ...mktOn, killSwitch: true };
assert.equal(isKillSwitchActive(killed), true);
assert.equal(
  resolveChargePath(killed, "marketplace", { canaryKey: "x" }),
  "legacy"
);

const key = "stable-mkt-user-9";
const bucket = canaryBucket(key);
assert.ok(bucket >= 0 && bucket < 100);
assert.equal(isInCanaryBucket(key, 0), false);
assert.equal(isInCanaryBucket(key, 100), true);

async function run(): Promise<void> {
  resetCutoverMetricsForTests();
  clearRememberedQuoteSnapshotsForTests();

  const capture = {
    currency: "USD",
    subtotal_cents: 10000,
    delivery_fee_cents: 800,
    service_fee_cents: 0,
    total_cents: 10800,
  };

  const legacySel = await selectMarketplaceChargePath({
    capture,
    countryCode: "US",
    canaryKey: "u1",
    flags: defaults,
    persistSnapshot: false,
  });
  assert.equal(legacySel.chargePath, "legacy");
  assert.equal(legacySel.customerTotalCents, 10800);

  const engineSel = await selectMarketplaceChargePath({
    capture,
    countryCode: "US",
    canaryKey: "u1",
    flags: mktOn,
    persistSnapshot: false,
  });
  assert.equal(engineSel.chargePath, "engine");
  assert.equal(engineSel.customerTotalCents, 10800);
  assert.ok(engineSel.snapshot);
  assert.equal(engineSel.snapshot?.service, "marketplace");
  assert.equal(getRememberedQuoteSnapshots().length, 1);

  const killSel = await selectMarketplaceChargePath({
    capture,
    canaryKey: "u1",
    flags: killed,
    persistSnapshot: false,
  });
  assert.equal(killSel.chargePath, "legacy");

  const keys = Array.from({ length: 1000 }, (_, i) => `mkt-canary-${i}`);
  for (const tier of [1, 5, 25, 50, 100]) {
    let engine = 0;
    for (const k of keys) {
      if (
        resolveChargePath(
          { ...mktOn, canaryPct: tier },
          "marketplace",
          { canaryKey: k }
        ) === "engine"
      ) {
        engine += 1;
      }
    }
    const pct = (engine / keys.length) * 100;
    if (tier === 100) assert.equal(engine, keys.length);
    else {
      assert.ok(
        Math.abs(pct - tier) <= 3,
        `canary tier ${tier}% got ${pct}%`
      );
    }
  }

  const metrics = getCutoverMetricsSnapshot();
  assert.ok(metrics.marketplaceEngine >= 1);
  assert.ok(metrics.marketplaceLegacy >= 1);

  console.log("pricingEngine Phase 5 marketplace cutover OK", {
    canaryBucketSample: bucket,
    metrics,
  });
}

void run();
