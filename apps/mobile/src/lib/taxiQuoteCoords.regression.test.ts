/**
 * Regression: taxi quote checkout must reject invalid / 0,0 coordinates.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/taxi/TaxiQuoteScreen.tsx"),
  "utf8",
);

assert.match(src, /isValidCoordinate\(pickupLat, pickupLng\)/);
assert.match(src, /isValidCoordinate\(dropoffLat, dropoffLng\)/);
assert.doesNotMatch(
  src,
  /Number\.isFinite\(pickupLat\)[\s\S]{0,120}Number\.isFinite\(dropoffLng\)/,
  "quote must not use naive isFinite for coords",
);

console.log("taxiQuoteCoords.regression.test.ts OK");
