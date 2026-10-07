import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const hook = read("../hooks/useLiveDriverLocation.ts");
assert.match(hook, /unsubscribeSupabaseChannel/);
assert.match(hook, /SIGNED_OUT/);
assert.match(hook, /driver_id=eq\.\$\{driverId\}/);
assert.match(hook, /table: "driver_locations"/);

const taxi = read("../screens/taxi/TaxiRideTrackingScreen.tsx");
assert.match(taxi, /\["completed", "cancelled", "canceled"\]/);
assert.match(taxi, /useLiveDriverLocation\(liveDriverId\)/);

const order = read("../screens/ClientOrderDetailsScreen.tsx");
assert.match(order, /!isFinalStatus\(order\.status\) \? order\.driver_id : null/);

const delivery = read("../screens/ClientDeliveryRequestDetailsScreen.tsx");
assert.match(delivery, /\["delivered", "completed", "canceled", "cancelled"\]/);
assert.match(delivery, /useLiveDriverLocation\(liveDriverId\)/);

const restaurantHook = read("../features/restaurant/hooks/useRestaurantCommandCenter.ts");
assert.doesNotMatch(restaurantHook, /table: "driver_locations"/);

const restaurantMap = read("../features/restaurant/components/RestaurantLiveMap.tsx");
assert.doesNotMatch(restaurantMap, /driver\.lat/);
assert.doesNotMatch(restaurantMap, /driver\.lng/);
assert.match(restaurantMap, /restaurant\.commandCenter\.driverArrived|LIVE_OPS_STATUS/);

const restaurantApi = read("./restaurantCommandCenterApi.ts");
const mapType = restaurantApi.slice(
  restaurantApi.indexOf("export type CommandCenterMapDriver"),
  restaurantApi.indexOf("export type CommandCenterMapCustomer"),
);
assert.equal(mapType.includes("lat:"), false);
assert.equal(mapType.includes("lng:"), false);

console.log("liveTripPrivacy.regression.test.ts OK");
