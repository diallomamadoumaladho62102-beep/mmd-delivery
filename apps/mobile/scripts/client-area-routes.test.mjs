/**
 * Ensures marketplace and seller routes stay in the client auth-sync guard.
 * Run: node scripts/client-area-routes.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const navPath = path.join(__dirname, "..", "src", "navigation", "AppNavigator.tsx");
const source = fs.readFileSync(navPath, "utf8");

const MARKETPLACE_SELLER_ROUTES = [
  "MarketplaceHome",
  "MarketplaceProductList",
  "MarketplaceProductDetails",
  "MarketplaceCart",
  "SellerGate",
  "SellerOnboarding",
  "SellerDashboard",
  "SellerProducts",
  "SellerOrders",
];

const match = source.match(
  /const isInClientArea[\s\S]*?return \([\s\S]*?\);\s*\}, \[\]\);/
);
assert.ok(match, "isInClientArea block not found in AppNavigator.tsx");

for (const route of MARKETPLACE_SELLER_ROUTES) {
  assert.match(
    match[0],
    new RegExp(`r === "${route}"`),
    `isInClientArea must include ${route} to avoid resetTo("ClientHome") on auth sync`
  );
}

console.log("client-area-routes.test.mjs ALL PASS");
