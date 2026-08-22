import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDeliveryRequestAmountCents } from "./deliveryRequestAmountCents";
import { resolveOrderAmountCents } from "./orderAmountCents";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "../../../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

assert.equal(
  resolveOrderAmountCents({ total_cents: 8000, net_charge_cents: 6500 }),
  6500
);
assert.equal(
  resolveDeliveryRequestAmountCents({ total_cents: 1200, net_charge_cents: 900 }),
  900
);

const walletBridge = readRepo("apps/web/src/lib/stripeInboundWalletBridge.ts");
assert.match(walletBridge, /resolveOrderAmountCents\(input\.order\)/);
assert.match(walletBridge, /resolveDeliveryRequestAmountCents\(input\.deliveryRequest\)/);

const createFood = readRepo("apps/web/src/lib/createFoodOrderWithDelivery.ts");
assert.match(createFood, /usesLocalMobileMoney/);
assert.match(createFood, /use_quote_checkout/);

const ordersNew = readRepo("apps/web/app/orders/new/page.tsx");
assert.match(ordersNew, /create-food-quote-checkout-session/);
assert.match(ordersNew, /usesLocalMobileMoney/);

const orderAmountLib = readRepo("apps/web/src/lib/orderAmountCents.ts");
assert.match(orderAmountLib, /net_charge_cents/);

const markDrPaid = readRepo(
  "apps/web/app/api/stripe/mark-delivery-request-paid/route.ts"
);
assert.match(markDrPaid, /confirm-delivery-request-paid/);
assert.doesNotMatch(markDrPaid, /verifyStripePaidMatchesDeliveryRequest/);

const confirmDrPaid = readRepo(
  "apps/web/app/api/stripe/client/confirm-delivery-request-paid/route.ts"
);
assert.match(confirmDrPaid, /enqueuePaymentSucceededAndProcessBatch/);
assert.match(confirmDrPaid, /finance_sync_pending/);
assert.match(confirmDrPaid, /resolveDeliveryRequestAmountCents/);

const confirmPaid = readRepo("apps/web/app/api/stripe/client/confirm-paid/route.ts");
assert.match(confirmPaid, /enqueuePaymentSucceededAndProcessBatch/);
assert.match(confirmPaid, /finance_sync_pending/);

const foodCheckout = readRepo("apps/web/src/lib/food/foodCheckoutFromQuote.ts");
assert.match(foodCheckout, /Succeeded Stripe settlement uses frozen snapshot/);
assert.doesNotMatch(
  foodCheckout,
  /if \(new Date\(String\(intent\.expires_at\)\)\.getTime\(\) < Date\.now\(\)\) \{\s+if \(String\(intent\.status\) !== "paid"\)/
);

const deliveryCheckout = readRepo(
  "apps/web/src/lib/delivery/deliveryCheckoutFromQuote.ts"
);
assert.match(
  deliveryCheckout,
  /Succeeded Stripe settlement uses frozen snapshot/
);

const financeEvents = readRepo("apps/web/src/lib/finance/financeEvents.ts");
assert.match(financeEvents, /enqueuePaymentSucceededAndProcessBatch/);

console.log("customerPaymentAmount.regression.test.ts — PASS");
