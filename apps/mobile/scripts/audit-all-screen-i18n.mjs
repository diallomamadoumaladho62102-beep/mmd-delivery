/**
 * Full-screen i18n audit: navigator routes, t()/tr() keys, French fallbacks,
 * missing keys across en/fr/es/ar/zh/ff.
 * Run: node scripts/audit-all-screen-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIntentional } from "./i18n-shared.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const localesDir = path.join(src, "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"];

const FRENCH_HINT =
  /[àâäéèêëïîôùûüçœÀÂÄÉÈÊËÏÎÔÙÛÜÇŒ]|\b(le|la|les|des|une|pour|avec|votre|merci|impossible|adresse|panier|paiement|commande|ajouter|annuler|retour|erreur|optionnel|chargement|confirmer|livraison|connecté|reconnecte|saisis|vérifie|réessaie)\b/i;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
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

function mergeDeep(base, override) {
  const out = { ...(base || {}) };
  for (const key of Object.keys(override || {})) {
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

function loadJson(lang, file) {
  const p = path.join(localesDir, lang, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

/** App runtime merge (resources.ts): en(common+extras) → locale common → locale extras */
function appBundle(lang) {
  const en = mergeDeep(loadJson("en", "common.json"), loadJson("en", "extras.json"));
  if (lang === "en") return flatten(en);
  return flatten(mergeDeep(mergeDeep(en, loadJson(lang, "common.json")), loadJson(lang, "extras.json")));
}

function extrasOnly(lang) {
  return flatten(loadJson(lang, "extras.json"));
}

const nav = fs.readFileSync(path.join(src, "navigation", "AppNavigator.tsx"), "utf8");
const tabs = fs.readFileSync(path.join(src, "navigation", "DriverTabs.tsx"), "utf8");
const routes = [
  ...nav.matchAll(/name="([A-Za-z0-9]+)"/g),
  ...tabs.matchAll(/name="([A-Za-z0-9]+)"/g),
].map((m) => m[1]);
const uniqueRoutes = [...new Set(routes)];

const hardcodedTitles = [...nav.matchAll(/options=\{\{\s*title:\s*"([^"]+)"/g)].map((m) => m[1]);

const KEY_RE =
  /(?:t|tr|ts|translate)\(\s*(["'`])([a-zA-Z][\w]*(?:\.[\w]+)+)\1(?:\s*,\s*(?:(["'`])([\s\S]*?)\3|\{[\s\S]*?defaultValue\s*:\s*(["'`])([\s\S]*?)\5))?/g;

const files = [
  ...walk(path.join(src, "screens")),
  ...walk(path.join(src, "components")),
  ...walk(path.join(src, "features")),
  ...walk(path.join(src, "navigation")),
];

const usages = [];
const frenchFallbacks = [];
const screensWithoutI18n = [];

for (const file of files) {
  const rel = path.relative(src, file).replace(/\\/g, "/");
  const content = fs.readFileSync(file, "utf8");
  if (rel.startsWith("screens/") && rel.endsWith("Screen.tsx") && !content.includes("useTranslation")) {
    screensWithoutI18n.push(rel);
  }
  let m;
  const re = new RegExp(KEY_RE.source, "g");
  while ((m = re.exec(content))) {
    const key = m[2];
    const fallback = m[4] ?? m[6] ?? "";
    usages.push({ file: rel, key, fallback });
    if (fallback && FRENCH_HINT.test(fallback)) {
      frenchFallbacks.push({ file: rel, key, fallback: fallback.slice(0, 120) });
    }
  }
}

const uniqueKeys = [...new Set(usages.map((u) => u.key))].sort();
const bundles = Object.fromEntries(LANGS.map((lang) => [lang, appBundle(lang)]));
const enExtras = extrasOnly("en");

const missingByLang = {};
for (const lang of LANGS) {
  missingByLang[lang] = uniqueKeys.filter((k) => !String(bundles[lang][k] || "").trim());
}

const extrasMissingInLocales = {};
for (const lang of LANGS.filter((l) => l !== "en")) {
  const loc = extrasOnly(lang);
  extrasMissingInLocales[lang] = Object.keys(enExtras).filter((k) => !String(loc[k] || "").trim());
}

const leftoverEnglish = {};
for (const lang of ["fr", "es", "ar", "zh", "ff"]) {
  leftoverEnglish[lang] = uniqueKeys.filter((k) => {
    if (!k.includes(".")) return false;
    const en = bundles.en[k];
    const loc = bundles[lang][k];
    if (!en || !loc) return !loc;
    if (en !== loc) return false;
    if (isIntentional(en, lang)) return false;
    if (en.length <= 3) return false;
    if (!/[A-Za-z]{4,}/.test(en)) return false;
    return true;
  });
}

const report = {
  routes: uniqueRoutes,
  routeCount: uniqueRoutes.length,
  screenFiles: files.filter((f) => /Screen\.tsx$/.test(f)).length,
  uniqueKeys: uniqueKeys.length,
  usages: usages.length,
  hardcodedNavigatorTitles: hardcodedTitles,
  screensWithoutI18n,
  frenchFallbackCount: frenchFallbacks.length,
  frenchFallbacks: frenchFallbacks.slice(0, 200),
  missingByLang: Object.fromEntries(
    LANGS.map((lang) => [lang, { count: missingByLang[lang].length, keys: missingByLang[lang].slice(0, 80) }]),
  ),
  extrasGaps: Object.fromEntries(
    Object.entries(extrasMissingInLocales).map(([lang, keys]) => [lang, keys.length]),
  ),
  leftoverEnglishCounts: Object.fromEntries(
    Object.entries(leftoverEnglish).map(([lang, keys]) => [lang, keys.length]),
  ),
};

const outPath = path.join(root, "scripts", "audit-all-screen-i18n.report.json");
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  routes: report.routeCount,
  screenFiles: report.screenFiles,
  uniqueKeys: report.uniqueKeys,
  hardcodedTitles: hardcodedTitles,
  screensWithoutI18n,
  frenchFallbacks: report.frenchFallbackCount,
  missing: Object.fromEntries(LANGS.map((l) => [l, missingByLang[l].length])),
  extrasGaps: report.extrasGaps,
  leftoverEnglish: report.leftoverEnglishCounts,
}, null, 2));
