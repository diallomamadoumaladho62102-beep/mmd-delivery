/**
 * Regression: Driver Home bottom sheet / offer cards honor dynamic safe area.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../screens/DriverHomeScreen.tsx"), "utf8");

assert.match(src, /useSafeAreaInsets/, "driver home reads device insets");
assert.match(src, /resolveDriverTabBottomPadding/, "driver home uses tab bottom helper");
assert.match(src, /bottomPadding=\{bottomPanelOffset\}/, "premium sheet gets dynamic padding");
assert.match(src, /bottomPadding=\{bottomPanelOffset\}[\s\S]*OfferCard|OfferCard[\s\S]*bottomPadding=\{bottomPanelOffset\}/, "offer card gets dynamic padding");

console.log("driverHomeSafeArea.regression.test.ts OK");
