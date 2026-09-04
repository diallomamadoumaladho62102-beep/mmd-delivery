/**
 * Mobile client screen timeout guards (P1-6) + #121 intact.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const mobileRoot = join(import.meta.dirname, "../src");
const boot = readFileSync(join(mobileRoot, "lib/bootFailOpen.ts"), "utf8");
const home = readFileSync(join(mobileRoot, "screens/ClientHomeScreen.tsx"), "utf8");
const wallet = readFileSync(join(mobileRoot, "screens/ClientWalletScreen.tsx"), "utf8");
const history = readFileSync(
  join(mobileRoot, "screens/ClientOrderHistoryScreen.tsx"),
  "utf8",
);
const receipt = readFileSync(join(mobileRoot, "screens/EntityReceiptScreen.tsx"), "utf8");
const ai = readFileSync(join(mobileRoot, "screens/MmdAiScreen.tsx"), "utf8");

function test(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

test("Apple #121 Client Home timeout unchanged", () => {
  assert.match(boot, /CLIENT_HOME_FETCH_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(home, /CLIENT_HOME_FETCH_TIMEOUT_MS/);
  assert.match(home, /client_home_fetch/);
});

test("secondary client screens use CLIENT_SCREEN_FETCH_TIMEOUT_MS or AUTH", () => {
  assert.match(boot, /CLIENT_SCREEN_FETCH_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(wallet, /CLIENT_SCREEN_FETCH_TIMEOUT_MS/);
  assert.match(wallet, /client_wallet_fetch/);
  assert.match(wallet, /client_wallet_session/);
  assert.match(history, /client_order_history_fetch/);
  assert.match(history, /client_order_history_session/);
  assert.match(receipt, /client_receipt_fetch/);
  assert.match(ai, /AUTH_ACTION_TIMEOUT_MS/);
  assert.match(ai, /mmd_ai_chat/);
});

test("driver map trip load and Mapbox Directions have wall-clock timeouts", () => {
  const driverMap = readFileSync(
    join(mobileRoot, "screens/DriverMapScreen.tsx"),
    "utf8",
  );
  const navRoute = readFileSync(
    join(mobileRoot, "hooks/useDriverNavigationRoute.ts"),
    "utf8",
  );
  const taxiReceipt = readFileSync(
    join(mobileRoot, "screens/taxi/TaxiReceiptScreen.tsx"),
    "utf8",
  );
  const signOut = readFileSync(
    join(mobileRoot, "lib/signOutToRoleSelect.ts"),
    "utf8",
  );
  const walletApi = readFileSync(join(mobileRoot, "lib/walletApi.ts"), "utf8");
  const marketplaceApi = readFileSync(
    join(mobileRoot, "lib/marketplaceApi.ts"),
    "utf8",
  );
  const notificationsApi = readFileSync(
    join(mobileRoot, "lib/notificationsInboxApi.ts"),
    "utf8",
  );
  const driverWallet = readFileSync(
    join(mobileRoot, "screens/DriverWalletScreen.tsx"),
    "utf8",
  );
  assert.match(boot, /DRIVER_NAV_FETCH_TIMEOUT_MS\s*=\s*8_000/);
  assert.match(boot, /fetchWithTimeout/);
  assert.match(driverMap, /driver_map_load_trip/);
  assert.match(driverMap, /DRIVER_NAV_FETCH_TIMEOUT_MS/);
  assert.match(navRoute, /DRIVER_NAV_FETCH_TIMEOUT_MS/);
  assert.match(taxiReceipt, /taxi_receipt_fetch/);
  assert.match(signOut, /sign_out_auth/);
  assert.match(signOut, /AUTH_ACTION_TIMEOUT_MS/);
  assert.match(walletApi, /fetchWithTimeout/);
  assert.match(marketplaceApi, /marketplace_fetch/);
  assert.match(notificationsApi, /notifications_inbox_get/);
  assert.match(driverWallet, /driver_wallet_session/);
});

console.log("mobile client timeout regression passed");
