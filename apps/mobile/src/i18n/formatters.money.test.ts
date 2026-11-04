import assert from "node:assert/strict";
import {
  formatMoney,
  formatMoneyFromCents,
  priceCentsToMajor,
} from "./formatters.ts";

assert.equal(formatMoneyFromCents(0, "USD", "en"), "$0.00");
assert.equal(formatMoneyFromCents(250, "USD", "en"), "$2.50");
assert.equal(formatMoneyFromCents(0, "GNF", "fr"), "0 GNF");
assert.equal(formatMoneyFromCents(250, "GNF", "fr"), "250 GNF");
assert.match(formatMoneyFromCents(85000, "GNF", "fr"), /^85[\s\u00a0\u202f]000 GNF$/);

// Guinea taxi stores whole francs in total_cents — never divide by 100.
assert.equal(priceCentsToMajor(11020, "GNF"), 11020);
assert.equal(priceCentsToMajor(11020, "USD"), 110.2);
assert.equal(priceCentsToMajor(250, "USD"), 2.5);
assert.match(formatMoneyFromCents(11020, "GNF", "fr"), /^11[\s\u00a0\u202f]020 GNF$/);
assert.equal(formatMoney(231.43, "GNF", "fr").includes("GNF"), true);
assert.doesNotMatch(formatMoney(231.43, "GNF", "fr"), /\$/);
assert.equal(formatMoney(12.5, "USD", "en"), "$12.50");

console.log("formatters.money.test.ts OK");
