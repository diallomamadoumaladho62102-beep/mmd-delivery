/**
 * Full-app i18n gate: every navigator route + Screen.tsx must stay localized.
 * A new screen cannot reintroduce missing keys or French defaultValues.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTENTIONAL = JSON.parse(
  fs.readFileSync(
    path.join(root, "..", "scripts", "i18n-intentional-identical.json"),
    "utf8",
  ),
) as Record<string, string[]>;

function isIntentional(value: string, locale: string) {
  const locales = INTENTIONAL[value];
  return Array.isArray(locales) && (locales.includes("*") || locales.includes(locale));
}
const locales = path.join(root, "i18n", "locales");

const FRENCH =
  /[àâäéèêëïîôùûüçœÀÂÄÉÈÊËÏÎÔÙÛÜÇŒ]|\b(impossible|adresse|panier|paiement|commande|ajouter|annuler|retour|erreur|optionnel|chargement|confirmer|livraison|connecté|connexion|reconnecte)\b/i;

function flatten(obj: unknown, prefix = "", out: Record<string, string> = {}) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else if (typeof value === "string") out[next] = value;
  }
  return out;
}

function mergeDeep(base: unknown, override: unknown): unknown {
  if (base == null || typeof base !== "object" || Array.isArray(base)) {
    return override ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (override == null || typeof override !== "object" || Array.isArray(override)) {
    return out;
  }
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const bv = out[k];
    if (
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      out[k] = mergeDeep(bv, v);
    } else out[k] = v;
  }
  return out;
}

function load(lang: string, file: "common" | "extras") {
  return JSON.parse(
    fs.readFileSync(path.join(locales, lang, `${file}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function bundle(lang: string) {
  const en = mergeDeep(load("en", "common"), load("en", "extras"));
  if (lang === "en") return flatten(en);
  return flatten(mergeDeep(mergeDeep(en, load(lang, "common")), load(lang, "extras")));
}

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const nav = fs.readFileSync(path.join(root, "navigation", "AppNavigator.tsx"), "utf8");
const tabs = fs.readFileSync(path.join(root, "navigation", "DriverTabs.tsx"), "utf8");
const routes = [
  ...nav.matchAll(/name="([A-Za-z0-9]+)"/g),
  ...tabs.matchAll(/name="([A-Za-z0-9]+)"/g),
].map((m) => m[1]);
const uniqueRoutes = [...new Set(routes)];

assert.ok(uniqueRoutes.length >= 99, `expected ≥99 navigator routes, got ${uniqueRoutes.length}`);
assert.ok(uniqueRoutes.includes("ClientHome"));
assert.ok(uniqueRoutes.includes("DriverHomeTab"));
assert.ok(uniqueRoutes.includes("RestaurantHome"));
assert.ok(uniqueRoutes.includes("MarketplaceHome"));
assert.ok(uniqueRoutes.includes("TaxiHome"));
assert.ok(uniqueRoutes.includes("ClientAuth"));
assert.ok(uniqueRoutes.includes("DriverIdentityVerification"));
assert.ok(uniqueRoutes.includes("DeleteAccount"));

const hardcodedTitles = [...nav.matchAll(/options=\{\{\s*title:\s*["']([^"']+)["']/g)].map(
  (m) => m[1],
);
assert.deepEqual(
  hardcodedTitles,
  [],
  `navigator titles must use t(): ${hardcodedTitles.join(", ")}`,
);

const screenFiles = walk(path.join(root, "screens")).filter((f) => f.endsWith("Screen.tsx"));
assert.ok(screenFiles.length >= 98, `expected ≥98 Screen.tsx files, got ${screenFiles.length}`);

const screensWithoutI18n = screenFiles.filter((file) => {
  const content = fs.readFileSync(file, "utf8");
  return !content.includes("useTranslation");
});
assert.deepEqual(
  screensWithoutI18n.map((f) => path.relative(root, f).replace(/\\/g, "/")),
  [],
  "every Screen.tsx must call useTranslation",
);

const KEY_RE =
  /(?:^|[^A-Za-z0-9_])(?:t|tr|ts|translate)\(\s*(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\1(?:\s*,\s*(?:(["'])([\s\S]*?)\3|\{[\s\S]*?defaultValue\s*:\s*(["'])([\s\S]*?)\5))?/g;

const files = [
  ...walk(path.join(root, "screens")),
  ...walk(path.join(root, "components")),
  ...walk(path.join(root, "features")),
  ...walk(path.join(root, "navigation")),
];

const used = new Map<string, { fallbacks: Set<string>; files: Set<string> }>();
const frenchFallbacks: Array<{ file: string; key: string; fallback: string }> = [];

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const content = fs.readFileSync(file, "utf8");
  const re = new RegExp(KEY_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const key = m[2];
    const fallback = (m[4] ?? m[6] ?? "").trim();
    if (!used.has(key)) used.set(key, { fallbacks: new Set(), files: new Set() });
    used.get(key)!.files.add(rel);
    if (fallback) used.get(key)!.fallbacks.add(fallback);
    if (fallback && FRENCH.test(fallback)) {
      frenchFallbacks.push({ file: rel, key, fallback: fallback.slice(0, 80) });
    }
  }
}

assert.equal(
  frenchFallbacks.length,
  0,
  `French defaultValues remain:\n${frenchFallbacks
    .slice(0, 20)
    .map((f) => `${f.file} ${f.key} = ${f.fallback}`)
    .join("\n")}`,
);

const en = bundle("en");
const missingEn = [...used.keys()].filter((key) => {
  if (key === "common.error.title") return false;
  return !String(en[key] || "").trim();
});
assert.equal(
  missingEn.length,
  0,
  `missing EN keys (${missingEn.length}): ${missingEn.slice(0, 30).join(", ")}`,
);

const leftover: Record<string, string[]> = {};
for (const lang of ["fr", "es", "ar", "zh", "ff"] as const) {
  const loc = bundle(lang);
  leftover[lang] = [...used.keys()].filter((key) => {
    const ev = en[key];
    const lv = loc[key];
    if (!ev || !lv) return !lv;
    if (ev !== lv) return false;
    if (isIntentional(ev, lang)) return false;
    if (ev.length <= 3) return false;
    if (!/[A-Za-z]{4,}/.test(ev)) return false;
    return true;
  });
}

for (const lang of ["fr", "es", "ar", "zh", "ff"] as const) {
  assert.equal(
    leftover[lang].length,
    0,
    `${lang} leftover English/missing (${leftover[lang].length}): ${leftover[lang]
      .slice(0, 25)
      .join(", ")}`,
  );
}

assert.match(nav, /t\("location\.exactLocation"\)/);
assert.match(nav, /t\("driver\.identity\.screenTitle"\)/);
assert.match(nav, /t\("driver\.services\.title"\)/);
assert.match(nav, /t\("driver\.hotspots\.title"\)/);
assert.match(nav, /t\("driver\.vehicles\.title"\)/);
assert.match(nav, /t\("driver\.vehicle\.screenTitle"\)/);
assert.match(nav, /t\("restaurant\.automation\.title"\)/);

console.log(
  JSON.stringify({
    ok: true,
    routes: uniqueRoutes.length,
    screens: screenFiles.length,
    usedKeys: used.size,
  }),
);
