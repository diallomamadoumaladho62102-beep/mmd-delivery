/**
 * Phase 6 — static gate: hot paths use PE SoT; legacy compute entrypoints gone or unused.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..");

const HOT_PATHS = [
  "src/lib/foodOrderService.ts",
  "src/lib/deliveryRequestService.ts",
  "src/lib/marketplaceOrderService.ts",
  "src/lib/marketplaceLiveCheckoutService.ts",
  "src/lib/food/foodCheckoutFromQuote.ts",
  "src/lib/delivery/deliveryCheckoutFromQuote.ts",
  "app/api/orders/food/quote/route.ts",
  "app/api/delivery-requests/quote/route.ts",
  "app/api/stripe/client/create-food-quote-checkout-session/route.ts",
  "app/api/stripe/client/create-delivery-quote-checkout-session/route.ts",
  "app/api/stripe/client/create-taxi-quote-checkout-session/route.ts",
  "app/api/taxi/rides/quote/route.ts",
  "app/api/taxi/rides/create/route.ts",
  "app/api/mapbox/compute-distance/route.ts",
  "app/orders/new/page.tsx",
];

const FORBIDDEN = [
  /computeFoodOrderPricing/,
  /computeDeliveryRequestPricing/,
  /calculateTaxiFinalPriceSnapshot/,
  /computeMarketplaceCheckoutShadow/,
  /selectFoodChargePath/,
  /selectPackageChargePath/,
  /selectRideChargePath/,
  /selectMarketplaceChargePath/,
  /schedulePricingShadowCompare/,
  /isKillSwitchActive/,
  /resolvePricingEngineFlags/,
];

const DELETED_PATHS = [
  "src/lib/pricingEngine/flags.ts",
  "src/lib/pricingEngine/killSwitch.ts",
  "src/lib/pricingEngine/canary.ts",
  "src/lib/pricingEngine/cutoverMetrics.ts",
  "src/lib/pricingEngine/charge/selectFoodPackageCharge.ts",
  "src/lib/pricingEngine/charge/selectRideChargePath.ts",
  "src/lib/pricingEngine/charge/selectMarketplaceChargePath.ts",
  "src/lib/pricingEngine/shadow/runShadowCompare.ts",
  "src/lib/pricingEngine/observability/shadowObserve.ts",
  "src/lib/pricingEngine/engine/adapters/foodAdapter.ts",
];

/** Must not contain a live `export … function|async function` for legacy compute entrypoints. */
const LEGACY_EXPORT_FORBIDDEN = [
  /export\s+async\s+function\s+computeFoodOrderPricing\b/,
  /export\s+async\s+function\s+computeDeliveryRequestPricing\b/,
  /export\s+function\s+calculateTaxiFinalPriceSnapshot\b/,
  /export\s+function\s+computeMarketplaceCheckoutShadow\b/,
];

const LEGACY_COMPUTE_GONE = [
  "src/lib/foodOrderServerPricing.ts",
  "src/lib/deliveryRequestServerPricing.ts",
  "src/lib/taxiFinalPrice.ts",
  "src/lib/marketplaceCheckout.ts",
];

function run() {
  for (const rel of HOT_PATHS) {
    const src = readFileSync(join(root, rel), "utf8");
    for (const bad of FORBIDDEN) {
      assert.doesNotMatch(src, bad, `${rel} must not reference ${bad}`);
    }
  }

  for (const rel of DELETED_PATHS) {
    assert.equal(
      existsSync(join(root, rel)),
      false,
      `${rel} must be deleted in Phase 6`
    );
  }

  for (const rel of LEGACY_COMPUTE_GONE) {
    const src = readFileSync(join(root, rel), "utf8");
    for (const bad of LEGACY_EXPORT_FORBIDDEN) {
      assert.doesNotMatch(
        src,
        bad,
        `${rel} must not still export ${bad}`
      );
    }
  }

  assert.match(
    readFileSync(join(root, "src/lib/pricingEngine/phaseGate.ts"), "utf8"),
    /PRICING_ENGINE_MIGRATION_PHASE = 6/
  );

  console.log("pricingEngine Phase 6 SoT hot-path gate OK", {
    hotPathsChecked: HOT_PATHS.length,
    deletedChecked: DELETED_PATHS.length,
    legacyComputeChecked: LEGACY_COMPUTE_GONE.length,
  });
}

void run();
