/**
 * Google Play: in-app disclosure must appear BEFORE requestBackgroundPermissionsAsync.
 * Source-order guard — does not change GPS tracking behavior.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const locationSrc = fs.readFileSync(path.join(here, "location.ts"), "utf8");

const disclosureFn = "promptAndroidBackgroundLocationDisclosure";
const requestBg = "await Location.requestBackgroundPermissionsAsync";

assert.match(locationSrc, new RegExp(disclosureFn));
assert.match(locationSrc, /Platform\.OS === "android"/);
assert.match(locationSrc, /backgroundDisclosureTitle/);
assert.match(locationSrc, /backgroundDisclosureContinue/);
assert.match(locationSrc, /backgroundDisclosureNotNow/);

const disclosureIdx = locationSrc.indexOf(`await ${disclosureFn}`);
const requestIdx = locationSrc.indexOf(requestBg);
assert.ok(disclosureIdx > 0, "disclosure must be awaited in requestLocationPermissions");
assert.ok(requestIdx > 0, "background permission request must still exist");
assert.ok(
  disclosureIdx < requestIdx,
  "disclosure must run before requestBackgroundPermissionsAsync",
);

const androidGuardIdx = locationSrc.indexOf('Platform.OS === "android"');
assert.ok(
  androidGuardIdx > 0 && androidGuardIdx < disclosureIdx,
  "disclosure must be gated to Android",
);

assert.match(
  locationSrc,
  /foregroundGranted: true,\s*backgroundGranted: false/,
);
assert.doesNotMatch(
  locationSrc,
  /requestBackgroundPermissionsAsync\(\)[\s\S]{0,80}promptAndroidBackgroundLocationDisclosure/,
);

const locales = ["en", "fr", "es", "ar", "zh", "ff"] as const;
for (const lang of locales) {
  const common = JSON.parse(
    fs.readFileSync(
      path.join(here, `../i18n/locales/${lang}/common.json`),
      "utf8",
    ),
  );
  const gps = common?.driver?.home?.gps;
  assert.ok(
    String(gps?.backgroundDisclosureTitle ?? "").trim().length > 3,
    `${lang} backgroundDisclosureTitle`,
  );
  assert.ok(
    String(gps?.backgroundDisclosureBody ?? "").includes("MMD Delivery"),
    `${lang} backgroundDisclosureBody must name MMD Delivery`,
  );
  assert.ok(
    String(gps?.backgroundDisclosureContinue ?? "").trim().length > 1,
    `${lang} backgroundDisclosureContinue`,
  );
  assert.ok(
    String(gps?.backgroundDisclosureNotNow ?? "").trim().length > 1,
    `${lang} backgroundDisclosureNotNow`,
  );
}

const en = JSON.parse(
  fs.readFileSync(path.join(here, "../i18n/locales/en/common.json"), "utf8"),
);
assert.equal(
  en.driver.home.gps.backgroundDisclosureTitle,
  "Location while you are online",
);
assert.match(
  en.driver.home.gps.backgroundDisclosureBody,
  /even when the app is in the background or closed/i,
);
assert.equal(en.driver.home.gps.backgroundDisclosureContinue, "Continue");
assert.equal(en.driver.home.gps.backgroundDisclosureNotNow, "Not now");

console.log("androidBackgroundLocationDisclosure.test.ts OK");
