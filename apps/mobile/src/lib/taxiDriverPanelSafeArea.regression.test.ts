/**
 * Regression: idle taxi offer panel clears home sheet + safe area (iPad).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../components/driver/DriverTaxiPanel.tsx",
  ),
  "utf8",
);

assert.match(src, /useSafeAreaInsets/);
assert.match(src, /resolveDriverTabBottomPadding/);
assert.match(src, /idleBottomOffset/);
assert.doesNotMatch(src, /bottom:\s*190/);

console.log("taxiDriverPanelSafeArea.regression.test.ts OK");
