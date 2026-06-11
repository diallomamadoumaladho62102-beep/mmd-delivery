/**
 * i18n coverage audit for 6 supported locales.
 * Run: node scripts/test-i18n-coverage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const SUPPORTED = ["en", "fr", "es", "ar", "zh", "ff"];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function loadBundle(lang) {
  const common = loadJson(path.join(localesDir, lang, "common.json"));
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const extras = fs.existsSync(extrasPath) ? loadJson(extrasPath) : {};
  const enCommon = loadJson(path.join(localesDir, "en", "common.json"));
  const merged = mergeDeep(mergeDeep(lang === "en" ? {} : enCommon, common), extras);
  return flatten(merged);
}

const enFlat = loadBundle("en");
const enKeys = Object.keys(enFlat);
const requiredPrefixes = ["marketplace.", "seller.", "taxi.", "client.", "language."];

let score = 100;
const issues = [];

for (const lang of SUPPORTED) {
  const flat = loadBundle(lang);
  const missing = enKeys.filter((k) => !flat[k]?.trim());
  if (missing.length) {
    issues.push(`${lang}: missing ${missing.length} keys`);
    score -= Math.min(20, missing.length);
  }

  if (lang === "en") continue;

  for (const prefix of requiredPrefixes) {
    const prefixKeys = enKeys.filter((k) => k.startsWith(prefix));
    const translated = prefixKeys.filter((k) => flat[k] && flat[k] !== enFlat[k]);
    const ratio = prefixKeys.length ? translated.length / prefixKeys.length : 1;
    if (ratio < 0.75 && prefixKeys.length > 5) {
      issues.push(`${lang}: ${prefix} translated ${Math.round(ratio * 100)}%`);
      score -= 3;
    }
  }
}

score = Math.max(0, Math.min(100, Math.round(score)));

console.log("i18n coverage score:", score, "/100");
if (issues.length) {
  console.log("Issues:");
  for (const issue of issues.slice(0, 20)) console.log(" -", issue);
}

if (score < 90) {
  console.error("FAIL: i18n coverage below threshold (90)");
  process.exit(1);
}

console.log("PASS: i18n coverage");
