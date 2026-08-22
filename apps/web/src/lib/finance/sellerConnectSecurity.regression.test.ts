import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const protect = readRepo("supabase/migrations/20260930120000_seller_stripe_connect.sql");
assert.match(protect, /sellers_protect_stripe_columns/);
assert.match(protect, /new\.stripe_account_id := old\.stripe_account_id/);
assert.match(protect, /new\.stripe_charges_enabled := old\.stripe_charges_enabled/);
assert.match(protect, /new\.stripe_payouts_enabled := old\.stripe_payouts_enabled/);

const createConnect = readRepo("supabase/functions/create_connect_account/index.ts");
assert.match(createConnect, /roleRaw === "seller"/);
assert.match(createConnect, /type: "express"/);
assert.match(createConnect, /accountLinks\.create/);
assert.doesNotMatch(createConnect, /routing_number|account_number|iban/i);

const dashboard = readRepo("apps/mobile/src/screens/seller/SellerDashboardScreen.tsx");
assert.match(dashboard, /startStripeOnboarding\("seller"\)/);
assert.match(dashboard, /check_connect_status/);
assert.doesNotMatch(dashboard, /TextInput.*routing|bank account number/i);

const wallet = readRepo("apps/mobile/src/screens/seller/SellerWalletScreen.tsx");
assert.match(wallet, /startStripeOnboarding\("seller"\)/);
assert.match(wallet, /loadOwnSeller/);
assert.match(wallet, /countryCode/);

console.log("sellerConnectSecurity regression passed");
