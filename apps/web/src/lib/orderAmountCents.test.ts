import assert from "node:assert/strict";
import { resolveOrderAmountCents } from "./orderAmountCents";

assert.equal(
  resolveOrderAmountCents({ total_cents: 5000, net_charge_cents: 4200 }),
  4200,
  "prefers net_charge_cents when <= gross"
);

assert.equal(
  resolveOrderAmountCents({ total_cents: 5000, net_charge_cents: 6000 }),
  5000,
  "ignores net_charge above gross"
);

assert.equal(resolveOrderAmountCents({ total_cents: 5000 }), 5000);

console.log("orderAmountCents.test.ts — PASS");
