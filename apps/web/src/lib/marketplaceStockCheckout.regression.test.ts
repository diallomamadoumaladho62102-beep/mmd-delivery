import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const migration = readRepo(
  "supabase/migrations/20261122120000_marketplace_stock_wallet_hardening.sql"
);
assert.match(migration, /mmd_decrement_marketplace_stock/);
assert.match(migration, /stock_qty >= r\.quantity/);
assert.match(
  migration,
  /marketplace_seller_wallet_entries_order_type_uq/
);

const webhook = readRepo("apps/web/src/lib/marketplaceStripeWebhook.ts");
assert.match(webhook, /decrementMarketplaceStockForPaidOrder/);

const liveCheckout = readRepo("apps/web/src/lib/marketplaceLiveCheckoutService.ts");
assert.match(liveCheckout, /assertSellerStripeConnectReady/);
assert.match(liveCheckout, /resolveMarketplaceUnitPriceCents/);
assert.match(liveCheckout, /promo_price_cents/);
assert.match(liveCheckout, /Insufficient stock/);

console.log("marketplaceStockCheckout.regression.test.ts — PASS");
