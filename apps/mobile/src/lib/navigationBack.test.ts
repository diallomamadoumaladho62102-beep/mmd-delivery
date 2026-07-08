import assert from "node:assert/strict";
import {
  resolveDashboardFallback,
  canShowBackButton,
} from "../navigation/navigationBackPolicy";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("resolveDashboardFallback maps client routes to ClientHome", () => {
  assert.equal(resolveDashboardFallback("ClientProfile"), "ClientHome");
  assert.equal(resolveDashboardFallback("TaxiQuote"), "ClientHome");
  assert.equal(resolveDashboardFallback("MarketplaceCart"), "ClientHome");
});

test("resolveDashboardFallback maps driver routes to DriverTabs", () => {
  assert.equal(resolveDashboardFallback("DriverWallet"), "DriverTabs");
  assert.equal(resolveDashboardFallback("DriverServices"), "DriverTabs");
});

test("resolveDashboardFallback maps restaurant routes to RestaurantCommandCenter", () => {
  assert.equal(resolveDashboardFallback("RestaurantMenu"), "RestaurantCommandCenter");
  assert.equal(resolveDashboardFallback("RestaurantOrderAutomation"), "RestaurantCommandCenter");
});

test("canShowBackButton reflects navigation state", () => {
  assert.equal(canShowBackButton({ canGoBack: () => true }), true);
  assert.equal(canShowBackButton({ canGoBack: () => false }), false);
});

console.log("navigationBack tests passed");
