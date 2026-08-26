/**
 * Regression: TaxiRideTrackingScreen must never call hooks after early returns.
 * Root cause of "Rendered more hooks than during the previous render":
 * runAddStop / runChangeDest useCallback lived after `if (loading && !ride)` /
 * `if (!ride)` returns, so hook count jumped when the ride loaded.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../screens/taxi/TaxiRideTrackingScreen.tsx",
  ),
  "utf8",
);

const loadingReturn = src.indexOf("if (loading && !ride)");
const missingReturn = src.indexOf("if (!ride)");
const addStop = src.indexOf("const runAddStop = useCallback");
const changeDest = src.indexOf("const runChangeDest = useCallback");

assert.ok(loadingReturn > 0, "loading early return present");
assert.ok(missingReturn > loadingReturn, "unavailable early return after loading");
assert.ok(addStop > 0 && addStop < loadingReturn, "runAddStop hook before early returns");
assert.ok(changeDest > 0 && changeDest < loadingReturn, "runChangeDest hook before early returns");

const afterReturns = src.slice(loadingReturn);
assert.doesNotMatch(
  afterReturns,
  /\buse[A-Z][A-Za-z0-9]*\s*\(/,
  "no hooks (including custom hooks) after loading/unavailable early returns",
);

console.log("taxiTrackingHooks.regression.test.ts OK");
