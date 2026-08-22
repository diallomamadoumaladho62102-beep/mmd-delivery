import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../..");

const retrySrc = fs.readFileSync(
  path.join(webRoot, "src/lib/finance/retryAwaitingConnectTransfers.ts"),
  "utf8",
);
const webhookSrc = fs.readFileSync(
  path.join(webRoot, "src/lib/stripeConnectWebhook.ts"),
  "utf8",
);
const transferSrc = fs.readFileSync(
  path.join(webRoot, "app/api/stripe/transfers/run/route.ts"),
  "utf8",
);

assert.match(retrySrc, /target: "restaurant"/);
assert.match(retrySrc, /restaurant_transfer_id/);
assert.match(retrySrc, /executeMarketplacePayouts/);
assert.doesNotMatch(retrySrc, /accounts\.create/);

assert.match(webhookSrc, /retryAwaitingConnectTransfers/);
assert.match(webhookSrc, /sellerReady: updated\.seller/);

assert.match(transferSrc, /restaurant_connect_account_missing/);
assert.match(transferSrc, /isStripeSourceChargeId/);

console.log("retryAwaitingConnectTransfers regression passed");
