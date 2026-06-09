import assert from "node:assert/strict";
import {
  fromStripeAmount,
  toStripeAmount,
} from "./taxiStripeAmounts";
import {
  calculateTaxiFinalPriceSnapshot,
  isQuotePriceWithinTolerance,
} from "./taxiFinalPrice";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const INTERNATIONAL_MATRIX: Array<{
  country: string;
  currency: string;
  dbCents: number;
}> = [
  { country: "US", currency: "USD", dbCents: 1250 },
  { country: "BE", currency: "EUR", dbCents: 980 },
  { country: "FR", currency: "EUR", dbCents: 1500 },
  { country: "GN", currency: "GNF", dbCents: 150000 },
  { country: "SN", currency: "XOF", dbCents: 250000 },
  { country: "CI", currency: "XOF", dbCents: 180000 },
  { country: "ML", currency: "XOF", dbCents: 200000 },
  { country: "SL", currency: "SLE", dbCents: 4500 },
  { country: "MR", currency: "MRU", dbCents: 3200 },
];

for (const row of INTERNATIONAL_MATRIX) {
  test(`${row.country}/${row.currency} stripe round-trip`, () => {
    const stripe = toStripeAmount(row.currency, row.dbCents);
    const back = fromStripeAmount(row.currency, stripe);
    assert.equal(back, row.dbCents, `${row.currency} round-trip failed`);
  });
}

test("GNF/XOF never multiply ×100 to Stripe", () => {
  assert.equal(toStripeAmount("GNF", 150000), 1500);
  assert.equal(toStripeAmount("XOF", 250000), 2500);
  assert.equal(fromStripeAmount("GNF", 1500), 150000);
});

test("USD keeps cent precision on Stripe", () => {
  assert.equal(toStripeAmount("USD", 1250), 1250);
  assert.equal(fromStripeAmount("USD", 1250), 1250);
});

test("final price snapshot includes tax and shared discount", () => {
  const snap = calculateTaxiFinalPriceSnapshot({
    subtotal_cents: 10000,
    tax_cents: 800,
    shared_ride: true,
  });
  assert.equal(snap.gross_total_cents, 10800);
  assert.equal(snap.shared_discount_cents, 1620);
  assert.equal(snap.total_cents, 9180);
});

test("quote drift tolerance accepts promo-adjusted net total", () => {
  const gross = calculateTaxiFinalPriceSnapshot({
    subtotal_cents: 2000,
    tax_cents: 160,
  });
  const withPromo = calculateTaxiFinalPriceSnapshot({
    subtotal_cents: 2000,
    tax_cents: 160,
    promo_discount_cents: 300,
  });
  assert.equal(
    isQuotePriceWithinTolerance(withPromo.total_cents, withPromo.total_cents),
    true
  );
  assert.equal(
    isQuotePriceWithinTolerance(gross.total_cents, withPromo.total_cents),
    false
  );
});

console.log("taxi globalization P0 tests passed");
