import assert from "node:assert/strict";
import { assertPaidAmountMatches, extractProviderAmountCents } from "./paymentAmountMatch";

const orange = extractProviderAmountCents("orange_money_gn", { amount: 1500, currency: "GNF" });
assert.equal(orange.amountCents, 1500);
assert.equal(orange.currency, "GNF");

const paydunya = extractProviderAmountCents("paydunya", {
  invoice: { total_amount: 12.5, currency: "XOF" },
});
assert.equal(paydunya.amountCents, 1250);

assert.equal(
  assertPaidAmountMatches({
    expectedCents: 1500,
    expectedCurrency: "GNF",
    provider: "orange_money_gn",
    payload: { amount: 1500, currency: "GNF" },
  }).ok,
  true
);

assert.equal(
  assertPaidAmountMatches({
    expectedCents: 1500,
    expectedCurrency: "GNF",
    provider: "orange_money_gn",
    payload: { amount: 1400, currency: "GNF" },
  }).ok,
  false
);

assert.equal(
  assertPaidAmountMatches({
    expectedCents: 1500,
    expectedCurrency: "GNF",
    provider: "orange_money_gn",
    payload: { amount: 1600, currency: "GNF" },
  }).ok,
  false
);

const currency = assertPaidAmountMatches({
  expectedCents: 1500,
  expectedCurrency: "GNF",
  provider: "orange_money_gn",
  payload: { amount: 1500, currency: "XOF" },
});
assert.equal(currency.ok, false);
if (currency.ok === false) assert.equal(currency.error, "currency_mismatch");

const missing = assertPaidAmountMatches({
  expectedCents: 1500,
  expectedCurrency: "GNF",
  provider: "cinetpay",
  payload: { status: "paid" },
});
assert.equal(missing.ok, false);
if (missing.ok === false) assert.equal(missing.error, "provider_amount_missing");

console.log("paymentAmountMatch.test.ts OK");
