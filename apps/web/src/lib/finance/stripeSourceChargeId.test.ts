import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isStripeSourceChargeId } from "./stripeSourceChargeId";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("accepts card ch_ and Link py_ charge ids", () => {
  assert.equal(isStripeSourceChargeId("ch_3Abc123"), true);
  assert.equal(isStripeSourceChargeId("py_1LinkXYZ"), true);
  assert.equal(isStripeSourceChargeId("  py_1LinkXYZ  "), true);
});

test("rejects PaymentIntent / session / refund / empty", () => {
  assert.equal(isStripeSourceChargeId("pi_xxx"), false);
  assert.equal(isStripeSourceChargeId("cs_live_xxx"), false);
  assert.equal(isStripeSourceChargeId("re_xxx"), false);
  assert.equal(isStripeSourceChargeId("acct_xxx"), false);
  assert.equal(isStripeSourceChargeId(""), false);
  assert.equal(isStripeSourceChargeId(null), false);
});

test("food transfers/run uses shared validator (no ch_-only regex)", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/stripe/transfers/run/route.ts"),
    "utf8",
  );
  assert.match(src, /isStripeSourceChargeId/);
  assert.doesNotMatch(src, /\^ch_\[A-Za-z0-9\]\+\$/);
});

test("admin payouts retry uses shared validator", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/admin/payouts/retry/route.ts"),
    "utf8",
  );
  assert.match(src, /isStripeSourceChargeId/);
  assert.doesNotMatch(src, /\^ch_\[A-Za-z0-9\]\+\$/);
});

test("taxi fare transfer resolves via shared validator", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/finance/executeTaxiDriverFareTransfer.ts",
    ),
    "utf8",
  );
  assert.match(src, /isStripeSourceChargeId/);
});

test("marketplace seller source charge validates ch_/py_", () => {
  const src = fs.readFileSync(
    path.join(repoRoot, "apps/web/src/lib/marketplacePayoutService.ts"),
    "utf8",
  );
  assert.match(src, /isStripeSourceChargeId/);
});

console.log("stripeSourceChargeId tests passed");
