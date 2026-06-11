/**
 * Pure Node tests for i18n resources (no React Native imports).
 * Run: node scripts/i18n-coverage.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const langs = ["en", "fr", "es", "ar", "zh", "ff"];

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
  return flatten(mergeDeep(mergeDeep(lang === "en" ? {} : enCommon, common), extras));
}

function normalizeLocale(raw) {
  const base = String(raw ?? "").trim().toLowerCase().split("-")[0];
  if (base.startsWith("zh")) return "zh";
  if (base.startsWith("ar")) return "ar";
  if (base.startsWith("es")) return "es";
  if (base.startsWith("en")) return "en";
  if (base.startsWith("fr")) return "fr";
  if (base === "ff" || base === "fuc" || base === "fuf" || base === "pul") return "ff";
  return base;
}

function ensureAppLocale(locale) {
  const n = normalizeLocale(locale);
  return langs.includes(n) ? n : "en";
}

assert.equal(normalizeLocale("fr-FR"), "fr");
assert.equal(normalizeLocale("ar-EG"), "ar");
assert.equal(normalizeLocale("zh-Hans"), "zh");
assert.equal(normalizeLocale("ff-SN"), "ff");
assert.equal(ensureAppLocale("de-DE"), "en");

const enFlat = loadBundle("en");
for (const lang of langs) {
  const flat = loadBundle(lang);
  assert.ok(flat["marketplace.home.title"], `${lang} missing marketplace.home.title`);
  assert.ok(flat["seller.dashboard.title"], `${lang} missing seller.dashboard.title`);
  assert.ok(flat["taxi.ui.total"], `${lang} missing taxi.ui.total`);
  assert.ok(flat["language.pickerTitle"], `${lang} missing language.pickerTitle`);
}

const ffFlat = loadBundle("ff");
const clientKeys = Object.keys(enFlat).filter((k) => k.startsWith("client."));
const ffTranslated = clientKeys.filter((k) => ffFlat[k] && ffFlat[k] !== enFlat[k]);
assert.ok(ffTranslated.length >= 20, `ff client translations too low: ${ffTranslated.length}`);

console.log("i18n-coverage.test.mjs ALL PASS");
