/**
 * Phase 4 — Ride cutover tests (regression under Phase 5 gate).
 * Canary is deterministic.
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
import { selectRideChargePath } from "./charge/selectRideChargePath";
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
assert.equal(resolveChargePath(defaults, "ride"), "legacy");
assert.equal(resolveChargePath(defaults, "marketplace"), "legacy");
assert.equal(resolveChargePath(defaults, "food"), "legacy");

const rideOn: PricingEngineFlags = {
  shadowEnabled: true,
  canaryPct: 100,
  serviceEnabled: {
    ride: true,
    food: false,
    package: false,
    marketplace: false,
  },
  killSwitch: false,
};

assert.equal(
  resolveChargePath(rideOn, "ride", { canaryKey: "user-a" }),
  "engine"
);
assert.equal(
  resolveChargePath(rideOn, "marketplace", { canaryKey: "user-a" }),
  "legacy"
);
assert.equal(
  resolveChargePath(rideOn, "food", { canaryKey: "user-a" }),
  "legacy"
);

const allOn: PricingEngineFlags = {
  ...rideOn,
  serviceEnabled: {
    ride: true,
    food: true,
    package: true,
    marketplace: true,
  },
};

// At Phase 5+, marketplace may engine when SERVICE_MARKETPLACE ON
assert.equal(resolveChargePath(allOn, "ride", { canaryKey: "x" }), "engine");
assert.equal(resolveChargePath(allOn, "food", { canaryKey: "x" }), "engine");
assert.equal(
  resolveChargePath(allOn, "marketplace", { canaryKey: "x" }),
  "engine"
);
// Phase 4 gate regression: marketplace still legacy
assert.equal(
  resolveChargePathForPhase(allOn, "marketplace", 4, { canaryKey: "x" }),
  "legacy"
);

// Phase 3 gate: ride still legacy
assert.equal(
  resolveChargePathForPhase(allOn, "ride", 3, { canaryKey: "x" }),
  "legacy"
);
assert.equal(
  resolveChargePathForPhase(allOn, "ride", 4, { canaryKey: "x" }),
  "engine"
);

const killed: PricingEngineFlags = { ...rideOn, killSwitch: true };
assert.equal(isKillSwitchActive(killed), true);
assert.equal(resolveChargePath(killed, "ride", { canaryKey: "x" }), "legacy");

const key = "stable-ride-user-7";
const bucket = canaryBucket(key);
assert.ok(bucket >= 0 && bucket < 100);
assert.equal(isInCanaryBucket(key, 0), false);
assert.equal(isInCanaryBucket(key, 100), true);

async function run(): Promise<void> {
  resetCutoverMetricsForTests();
  clearRememberedQuoteSnapshotsForTests();

  const capture = {
    currency: "USD",
    subtotal_cents: 1000,
    tax_cents: 80,
    service_fee_cents: 0,
    platform_fee_cents: 250,
    driver_payout_cents: 750,
    total_cents: 1080,
  };

  const legacySel = await selectRideChargePath({
    capture,
    countryCode: "US",
    canaryKey: "u1",
    flags: defaults,
    persistSnapshot: false,
  });
  assert.equal(legacySel.chargePath, "legacy");
  assert.equal(legacySel.customerTotalCents, 1080);

  const engineSel = await selectRideChargePath({
    capture,
    countryCode: "US",
    canaryKey: "u1",
    flags: rideOn,
    persistSnapshot: false,
  });
  assert.equal(engineSel.chargePath, "engine");
  assert.equal(engineSel.customerTotalCents, 1080);
  assert.ok(engineSel.snapshot);
  assert.equal(engineSel.snapshot?.service, "ride");
  assert.equal(getRememberedQuoteSnapshots().length, 1);

  const killSel = await selectRideChargePath({
    capture,
    canaryKey: "u1",
    flags: killed,
    persistSnapshot: false,
  });
  assert.equal(killSel.chargePath, "legacy");

  // Canary ladder 1 → 5 → 25 → 50 → 100
  const keys = Array.from({ length: 1000 }, (_, i) => `ride-canary-${i}`);
  for (const tier of [1, 5, 25, 50, 100]) {
    let engine = 0;
    for (const k of keys) {
      if (
        resolveChargePath(
          { ...rideOn, canaryPct: tier },
          "ride",
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
  assert.ok(metrics.rideEngine >= 1);
  assert.ok(metrics.rideLegacy >= 1);

  console.log("pricingEngine Phase 4 ride cutover OK", {
    canaryBucketSample: bucket,
    metrics,
  });
}

void run();
