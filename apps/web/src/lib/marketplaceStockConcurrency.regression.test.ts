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
  "supabase/migrations/20261122140000_marketplace_stock_reserve.sql"
);
assert.match(migration, /stock_reserved_at/);
assert.match(migration, /mmd_reserve_marketplace_stock/);
assert.match(migration, /mmd_release_marketplace_stock/);
assert.match(migration, /for update of sp/);
assert.match(migration, /if reserved_at is not null then[\s\S]*return/);

const decrementMigration = readRepo(
  "supabase/migrations/20261122120000_marketplace_stock_wallet_hardening.sql"
);
assert.match(decrementMigration, /grant execute.*service_role/);
assert.match(decrementMigration, /revoke all.*from public/);

const service = readRepo("apps/web/src/lib/marketplaceStockService.ts");
assert.match(service, /reserveMarketplaceStockForCheckout/);
assert.match(service, /releaseMarketplaceStockAfterCheckoutAbandon/);
assert.match(service, /runExpireStaleMarketplaceStockReservations/);

const webhook = readRepo("apps/web/src/lib/marketplaceStripeWebhook.ts");
assert.match(webhook, /releaseMarketplaceStockAfterCheckoutAbandon/);

const cron = readRepo("apps/web/app/api/cron/expire-stale-payments/route.ts");
assert.match(cron, /runExpireStaleMarketplaceStockReservations/);
assert.match(service, /decrementMarketplaceStockForPaidOrder/);

console.log("marketplaceStockConcurrency.regression.test.ts — PASS");
