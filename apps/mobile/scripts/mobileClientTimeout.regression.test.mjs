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
  assert.match(history, /client_order_history_fetch/);
  assert.match(receipt, /client_receipt_fetch/);
  assert.match(ai, /AUTH_ACTION_TIMEOUT_MS/);
  assert.match(ai, /mmd_ai_chat/);
});

console.log("mobile client timeout regression passed");
