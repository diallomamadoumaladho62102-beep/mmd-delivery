/**
 * Regression: Taxi tracking Figma chrome uses real ride data + i18n, never Figma placeholders.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(here, "../screens/taxi/TaxiRideTrackingScreen.tsx"),
  "utf8",
);

assert.match(src, /ClientServiceBottomNav/);
assert.match(src, /accent=["']green["']/);
assert.match(src, /fetchTaxiRide/);
assert.match(src, /formatTaxiCents/);
assert.match(src, /t\("taxi\.tracking\.estimatedFare"/);
assert.match(src, /t\("taxi\.tracking\.offlineBanner"/);
assert.match(src, /t\("taxi\.ride\.addStopFailed"/);
assert.doesNotMatch(src, /JFK Airport/);
assert.doesNotMatch(src, /123 Main St/);
assert.doesNotMatch(src, /\$26\.70/);
assert.doesNotMatch(src, /Alex M/);

const localesDir = path.join(here, "../i18n/locales");
for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const extras = JSON.parse(
    fs.readFileSync(path.join(localesDir, lang, "extras.json"), "utf8"),
  );
  const tracking = extras?.taxi?.tracking ?? {};
  for (const key of [
    "lookingForDriver",
    "searchingNearby",
    "estimatedFare",
    "offlineBanner",
    "rideCompleted",
    "thanksRiding",
    "isDriving",
    "stopN",
  ]) {
    assert.ok(
      String(tracking[key] ?? "").trim(),
      `${lang} missing taxi.tracking.${key}`,
    );
  }
}

console.log("taxiTrackingFigma.regression.test.ts OK");
