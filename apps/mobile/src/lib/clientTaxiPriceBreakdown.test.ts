import assert from "node:assert/strict";
import { buildClientTaxiPriceBreakdown } from "./clientTaxiPriceBreakdown";

const breakdown = buildClientTaxiPriceBreakdown({
  subtotalCents: 2000,
  serviceFeeCents: 150,
  taxCents: 160,
  grossTotalCents: 2310,
  platformFeeCents: 800,
});

assert.equal(breakdown.subtotalCents, 2000);
assert.equal(breakdown.serviceFeeCents, 150);
assert.equal(breakdown.taxCents, 160);
assert.equal(breakdown.formulaGrossCents, 2310);
assert.equal(breakdown.totalCents, 2310);
assert.equal(
  breakdown.subtotalCents + breakdown.serviceFeeCents + breakdown.taxCents,
  breakdown.formulaGrossCents
);

const withInternalFee = buildClientTaxiPriceBreakdown({
  subtotalCents: 2000,
  serviceFeeCents: 150,
  taxCents: 160,
  grossTotalCents: 2310,
  platformFeeCents: 99999,
});
assert.equal(withInternalFee.totalCents, breakdown.totalCents);

const discounted = buildClientTaxiPriceBreakdown({
  subtotalCents: 2000,
  serviceFeeCents: 150,
  taxCents: 160,
  grossTotalCents: 2310,
  platformFeeCents: 800,
  discountCents: 310,
});
assert.equal(discounted.totalCents, 2000);

console.log("clientTaxiPriceBreakdown.test.ts OK");
