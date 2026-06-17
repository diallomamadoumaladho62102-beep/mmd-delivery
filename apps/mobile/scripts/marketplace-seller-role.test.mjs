/**
 * Marketplace seller role + driver job wiring checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const roleSelect = fs.readFileSync(
  path.join(root, "src", "screens", "RoleSelectScreen.tsx"),
  "utf8"
);
assert.match(roleSelect, /"seller"/);
assert.match(roleSelect, /Marketplace Seller/);
assert.match(roleSelect, /navigation\.navigate\("SellerGate"\)/);

const nav = fs.readFileSync(path.join(root, "src", "navigation", "AppNavigator.tsx"), "utf8");
assert.match(nav, /isInSellerArea/);
assert.match(nav, /role === "seller"/);

const driverHome = fs.readFileSync(
  path.join(root, "src", "screens", "DriverHomeScreen.tsx"),
  "utf8"
);
assert.match(driverHome, /fetchDriverMarketplaceJobs/);
assert.match(driverHome, /marketplace_delivery_jobs/);

const marketplaceHome = fs.readFileSync(
  path.join(root, "src", "screens", "marketplace", "MarketplaceHomeScreen.tsx"),
  "utf8"
);
assert.match(marketplaceHome, /is_accepting_orders/);
assert.match(marketplaceHome, /shopOpen/);

console.log("marketplace-seller-role.test.mjs ALL PASS");
