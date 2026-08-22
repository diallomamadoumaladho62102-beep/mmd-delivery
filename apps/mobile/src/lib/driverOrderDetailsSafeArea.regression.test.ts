/**
 * Regression: Driver order details must honor safe-area insets for bottom CTAs
 * (Apple iPad review: accept/verify buttons were clipped behind home bar).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(here, "../screens/DriverOrderDetailsScreen.tsx"),
  "utf8",
);

assert.match(src, /useSafeAreaInsets/, "order details reads device insets");
assert.match(
  src,
  /resolveDriverStackActionBottom|resolveDriverStackScrollBottomPadding/,
  "order details uses shared bottom safe-area helpers",
);
assert.doesNotMatch(
  src,
  /bottom:\s*16,/,
  "hard-coded bottom:16 must not clip CTAs on iPad",
);

console.log("driverOrderDetailsSafeArea.regression.test.ts OK");
