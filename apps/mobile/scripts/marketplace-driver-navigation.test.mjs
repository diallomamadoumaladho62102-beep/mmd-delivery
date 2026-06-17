/**
 * Marketplace driver native navigation wiring checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const driverMap = fs.readFileSync(
  path.join(root, "src", "screens", "DriverMapScreen.tsx"),
  "utf8"
);
const driverNavTypes = fs.readFileSync(
  path.join(root, "src", "lib", "driverNavigation", "types.ts"),
  "utf8"
);
const marketplaceNav = fs.readFileSync(
  path.join(root, "src", "lib", "marketplaceDriverNavigation.ts"),
  "utf8"
);
const orderDetails = fs.readFileSync(
  path.join(root, "src", "screens", "DriverOrderDetailsScreen.tsx"),
  "utf8"
);
const externalNav = fs.readFileSync(
  path.join(root, "src", "lib", "externalNavigationApps.ts"),
  "utf8"
);

assert.match(driverNavTypes, /marketplace_delivery_jobs/);
assert.match(driverMap, /marketplace_delivery_jobs/);
assert.match(driverMap, /MARKETPLACE_DELIVERY_JOB_NAV_SELECT/);
assert.match(driverMap, /from\("marketplace_delivery_jobs"\)/);
assert.match(driverMap, /coordsFromLocationJoin/);
assert.match(marketplaceNav, /pickup:pickup_location_id\(pin_lat,pin_lng/);
assert.match(orderDetails, /applyMarketplaceCoordsToOrder/);
assert.match(orderDetails, /navigate\("DriverMap"/);
assert.match(externalNav, /openWazeNavigation/);
assert.match(externalNav, /openGoogleMapsNavigation/);

console.log("marketplace-driver-navigation.test.mjs ALL PASS");
