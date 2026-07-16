import assert from "node:assert/strict";
import { isWithinBudget, summarizeVitals, WEB_VITALS_BUDGETS } from "./webVitalsBudgets";

assert.equal(isWithinBudget("LCP", 2000).ok, true);
assert.equal(isWithinBudget("LCP", WEB_VITALS_BUDGETS.LCP_MS + 1).ok, false);
assert.equal(isWithinBudget("CLS", 0.05).ok, true);
assert.equal(isWithinBudget("INP", 50).ok, true);

const summary = summarizeVitals([
  { name: "LCP", value: 1800 },
  { name: "INP", value: 500 },
]);
assert.equal(summary.ok, false);
assert.equal(summary.failures[0]?.name, "INP");

console.log("webVitalsBudgets tests passed");
