import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const pricing = readRepo("apps/web/src/lib/marketplaceCheckoutPricing.ts");
assert.match(pricing, /applyMarketplaceCheckoutBenefits/);
assert.match(pricing, /resolveMarketingOffers/);
assert.match(pricing, /resolveMmdPlusCheckoutBenefits/);

const live = readRepo("apps/web/src/lib/marketplaceLiveCheckoutService.ts");
assert.match(live, /applyMarketplaceCheckoutBenefits/);
assert.match(live, /reserveAndAttachMarketing/);
assert.match(live, /reserveMarketplaceStockForCheckout/);
assert.match(live, /releaseMarketplaceStockReservation/);

console.log("marketplaceCheckoutPricing.regression.test.ts — PASS");
