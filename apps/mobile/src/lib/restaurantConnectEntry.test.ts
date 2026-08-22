import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

const card = read("features/restaurant/components/RestaurantStripeConnectCard.tsx");
assert.match(card, /startStripeOnboarding\("restaurant"\)/);
assert.match(card, /restaurantStripeConnectCta/);
assert.match(card, /check_connect_status/);
assert.doesNotMatch(card, /routing_number|account_number|iban/i);
assert.doesNotMatch(card, /TextInput/);

const entryFiles = [
  "screens/RestaurantEarningsScreen.tsx",
  "screens/RestaurantFinancialCenterScreen.tsx",
  "screens/restaurant/RestaurantCommandCenterScreen.tsx",
  "screens/restaurant/RestaurantWalletScreen.tsx",
];

for (const file of entryFiles) {
  const src = read(file);
  assert.match(
    src,
    /RestaurantStripeConnectCard/,
    `${file} must reuse the official Stripe Express card`,
  );
  assert.doesNotMatch(src, /restaurant-connect-link/);
  assert.doesNotMatch(src, /routing_number|account_number|iban/i);
}

const home = read("screens/RestaurantHomeScreen.tsx");
assert.match(home, /case "payouts":/);
assert.match(home, /navigate\("RestaurantEarnings"\)/);

console.log("restaurantConnectEntry.test.ts OK");
