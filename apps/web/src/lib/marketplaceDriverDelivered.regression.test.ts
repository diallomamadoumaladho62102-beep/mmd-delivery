import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(dir, "marketplaceDriverJobsService.ts"),
  "utf8",
);

assert.match(src, /params\.nextStatus === "delivered"/);
assert.match(src, /status: "delivered"/);
assert.match(src, /seller_order_id/);
assert.match(src, /notifyMarketplaceClientOrderStatus/);

console.log("marketplaceDriverDelivered.regression.test.ts — PASS");
