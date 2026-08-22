/**
 * Regression: at pickup/dropoff arrival, nav chrome yields to the top arrival panel.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mapSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/DriverMapScreen.tsx"),
  "utf8",
);
const bannerSrc = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../components/driver/DriverArrivalBanner.tsx",
  ),
  "utf8",
);

assert.match(mapSrc, /destinationArrived \? \([\s\S]*DriverArrivalBanner/);
assert.match(mapSrc, /!destinationArrived \? \([\s\S]*DriverNavigationHud/);
assert.match(mapSrc, /!destinationArrived \? \([\s\S]*DriverNavigationBottomBar/);
assert.match(bannerSrc, /resolveHudTopPadding\(insets\.top\)/);
assert.match(bannerSrc, /position: "absolute"[\s\S]*top,/);

console.log("taxiArrivalNavChrome.regression.test.ts OK");
