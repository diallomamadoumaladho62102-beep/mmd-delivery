import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const bottomNav = read("components/navigation/ClientServiceBottomNav.tsx");
assert.match(bottomNav, /focusActive: true/);

const history = read("screens/ClientOrderHistoryScreen.tsx");
assert.match(history, /focusActive/);
assert.match(history, /isClientActiveStatus/);

const wallet = read("screens/ClientWalletScreen.tsx");
assert.match(wallet, /signOutToRoleSelect/);

const orderDetails = read("screens/ClientOrderDetailsScreen.tsx");
assert.match(orderDetails, /insets\.bottom/);

const homeV4 = read("components/client/home/ClientHomeV4View.tsx");
assert.match(homeV4, /V4_BOTTOM_SAFE/);
assert.match(homeV4, /insets\.bottom \+ 88/);

const deliveryRequest = read("screens/DeliveryRequestScreen.tsx");
assert.match(deliveryRequest, /useSafeAreaInsets/);
assert.match(deliveryRequest, /edges=\{\["top", "left", "right"\]\}/);
assert.match(deliveryRequest, /insets\.bottom \+ 88/);

const navigator = read("navigation/AppNavigator.tsx");
assert.match(navigator, /ClientOrderHistory: \{ focusActive\?: boolean \}/);

console.log("customerMobile.regression.test.ts — PASS");
