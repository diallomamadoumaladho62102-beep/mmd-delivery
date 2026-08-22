import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(srcRoot, rel), "utf8");
}

const stripe = read("utils/stripe.ts");
assert.match(stripe, /create_connect_account/);
assert.match(stripe, /startStripeOnboarding/);
assert.match(stripe, /role: "driver" \| "restaurant" \| "seller"/);

for (const file of [
  "screens/DriverWalletScreen.tsx",
  "screens/DriverProfileScreen.tsx",
  "screens/DriverMenuScreen.tsx",
]) {
  const src = read(file);
  assert.match(src, /startStripeOnboarding\("driver"\)/, `${file} must open official Express`);
  assert.doesNotMatch(src, /routing_number|account_number|iban/i);
}

console.log("driverConnectEntry.test.ts OK");
