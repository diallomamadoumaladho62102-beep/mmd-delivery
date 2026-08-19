import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../../..");

test("taxi SCT surfaces Stripe error and available-balance fallback", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/finance/executeTaxiDriverFareTransfer.ts",
    ),
    "utf8",
  );
  assert.match(src, /stripe_code/);
  assert.match(src, /platform_available/);
  assert.match(src, /from_available/);
  assert.match(src, /source_transaction_fallback/);
  assert.match(src, /balance_insufficient|insufficient/);
});

test("taxi-run API returns stripe_code on failure", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/app/api/stripe/transfers/taxi-run/route.ts",
    ),
    "utf8",
  );
  assert.match(src, /stripe_code/);
  assert.match(src, /source_charge_id/);
});

console.log("taxi SCT error + fallback regression passed");
