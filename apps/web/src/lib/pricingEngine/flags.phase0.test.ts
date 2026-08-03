/**
 * Phase 0 — flag + kill-switch + phase gate must keep charge on legacy.
 */
import assert from "node:assert/strict";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "./flags";
import {
  isKillSwitchActive,
  isShadowCompareAllowed,
  resolveChargePathForPhase,
} from "./killSwitch";
import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import { compareLegacyVsEngine, recordShadowCompare } from "./observability/shadowObserve";

assert.equal(PRICING_ENGINE_MIGRATION_PHASE, 5);

const defaults = resolvePricingEngineFlags({});
assert.equal(defaults.shadowEnabled, false);
assert.equal(defaults.canaryPct, 0);
assert.equal(defaults.killSwitch, false);
assert.equal(defaults.serviceEnabled.ride, false);
assert.equal(defaults.serviceEnabled.food, false);
assert.equal(defaults.serviceEnabled.package, false);
assert.equal(defaults.serviceEnabled.marketplace, false);
assert.equal(isKillSwitchActive(defaults), false);
assert.equal(isShadowCompareAllowed(defaults), false);
assert.equal(resolveChargePath(defaults, "food"), "legacy");

const misconfigured = resolvePricingEngineFlags({
  PRICING_ENGINE_SHADOW: "true",
  PRICING_ENGINE_CANARY_PCT: "100",
  PRICING_ENGINE_SERVICE_FOOD: "true",
  PRICING_ENGINE_KILL_SWITCH: "false",
});
assert.equal(isShadowCompareAllowed(misconfigured), true);
// Defaults without canaryKey: still legacy when canary < 100... here canary=100 → engine for food
assert.equal(resolveChargePath(misconfigured, "food"), "engine");
assert.equal(resolveChargePath(misconfigured, "ride"), "legacy");
assert.equal(resolveChargePathForPhase(misconfigured, "food", 0), "legacy");
assert.equal(resolveChargePathForPhase(misconfigured, "food", 2), "legacy");
assert.equal(
  resolveChargePathForPhase(misconfigured, "food", 3, { canaryKey: "u" }),
  "engine"
);

const killed = resolvePricingEngineFlags({
  PRICING_ENGINE_KILL_SWITCH: "true",
  PRICING_ENGINE_SHADOW: "true",
  PRICING_ENGINE_SERVICE_FOOD: "true",
});
assert.equal(isKillSwitchActive(killed), true);
assert.equal(isShadowCompareAllowed(killed), false);
assert.equal(resolveChargePath(killed, "food"), "legacy");

const cmp = compareLegacyVsEngine({
  service: "food",
  legacyTotalCents: 1000,
  engineTotalCents: 1005,
  currency: "USD",
});
assert.equal(cmp.equal, false);
assert.equal(cmp.diffCents, 5);
recordShadowCompare(cmp);

console.log("pricingEngine Phase 0 flags/kill/shadow OK");
