import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const localesDir = path.join(__dirname, "../i18n/locales");
const langs = ["en", "fr", "es", "ar", "zh", "ff"];

function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function mergeDeep(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      out[key] &&
      typeof out[key] === "object"
    ) {
      out[key] = mergeDeep(out[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

function flatten(obj, prefix = "", out = {}) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else if (typeof value === "string") {
      out[next] = value;
    }
  }
  return out;
}

function loadBundle(lang) {
  const common = loadJson(path.join(localesDir, lang, "common.json"));
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const extras = fs.existsSync(extrasPath) ? loadJson(extrasPath) : {};
  const enCommon = loadJson(path.join(localesDir, "en", "common.json"));
  return flatten(
    mergeDeep(mergeDeep(lang === "en" ? {} : enCommon, common), extras),
  );
}

const requiredKeys = [
  "common.continue",
  "taxi.ride.addStop",
  "taxi.ride.changeDest",
  "taxi.ride.cancelReasonTitle",
  "taxi.ride.cancelOtherTitle",
  "taxi.ride.cancelReasons.changed_mind",
  "taxi.ride.cancelReasons.emergency",
  "driver.taxiPanel.cancelTitle",
  "driver.taxiPanel.cancelWarn",
  "driver.taxiPanel.cancelReasons.vehicle_issue",
  "driver.taxiPanel.cancelReasons.wrong_trip_details",
];

const en = loadBundle("en");

test("new taxi cancel/stop/dest keys exist in all 6 locales", () => {
  for (const lang of langs) {
    const flat = loadBundle(lang);
    for (const key of requiredKeys) {
      assert.ok(String(flat[key] ?? "").trim(), `${lang} missing ${key}`);
    }
  }
});

test("non-English locales do not reuse English for new taxi cancel keys", () => {
  for (const lang of langs.filter((l) => l !== "en")) {
    const flat = loadBundle(lang);
    for (const key of requiredKeys) {
      assert.notEqual(
        flat[key],
        en[key],
        `${lang} still English for ${key}: ${flat[key]}`,
      );
    }
  }
});

test("client tracking screen uses i18n reason keys not hardcoded English labels", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/mobile/src/screens/taxi/TaxiRideTrackingScreen.tsx",
    ),
    "utf8",
  );
  assert.match(src, /taxi\.ride\.cancelReasons\./);
  assert.doesNotMatch(src, /label: "Driver taking too long"/);
});

test("driver taxi panel uses i18n cancel reason keys", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/mobile/src/components/driver/DriverTaxiPanel.tsx",
    ),
    "utf8",
  );
  assert.match(src, /driver\.taxiPanel\.cancelReasons\./);
  assert.doesNotMatch(src, /label: "Vehicle issue"/);
});

test("image-size patch guards ICNS and JXL zero-size loops", () => {
  const patch = fs.readFileSync(
    path.join(repoRoot, "patches/image-size@1.2.1.patch"),
    "utf8",
  );
  assert.match(patch, /CVE-2025-71330/);
  assert.match(patch, /CVE-2025-71329/);
  assert.match(patch, /entryLength < 8/);
  assert.match(patch, /jxlpBox\.size > 0/);
});

console.log("taxiCancelI18nAndImageSize regression passed");
