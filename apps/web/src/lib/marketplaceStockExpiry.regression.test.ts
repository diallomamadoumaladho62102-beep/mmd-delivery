import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import {
  MARKETPLACE_CHECKOUT_SESSION_TTL_MS,
  marketplaceStockReservationCutoffIso,
} from "./marketplaceStockService";
import { EXPIRE_SAFETY_MARGIN_MS } from "./expireStalePayments";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const webhook = readRepo("apps/web/src/lib/marketplaceStripeWebhook.ts");
assert.match(webhook, /releaseMarketplaceStockAfterCheckoutAbandon/);
assert.match(webhook, /handleMarketplaceCheckoutSessionExpired/);

const cron = readRepo("apps/web/app/api/cron/expire-stale-payments/route.ts");
assert.match(cron, /runExpireStaleMarketplaceStockReservations/);
assert.match(cron, /handleMarketplaceCheckoutSessionExpired/);

const stock = readRepo("apps/web/src/lib/marketplaceStockService.ts");
assert.match(stock, /runExpireStaleMarketplaceStockReservations/);
assert.match(stock, /isStripeCheckoutSessionStillOpen/);

const now = Date.parse("2026-08-22T12:00:00.000Z");
const cutoff = marketplaceStockReservationCutoffIso(now);
const expectedMs =
  now - MARKETPLACE_CHECKOUT_SESSION_TTL_MS - EXPIRE_SAFETY_MARGIN_MS;
assert.equal(Date.parse(cutoff), expectedMs);

console.log("marketplaceStockExpiry.regression.test.ts — PASS");
