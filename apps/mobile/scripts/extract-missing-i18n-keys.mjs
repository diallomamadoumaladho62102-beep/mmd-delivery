/**
 * Extract real dotted i18n keys used in screens that are missing from EN bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const localesDir = path.join(src, "i18n", "locales");

function walk(dir, out = []) {
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
    } else if (typeof value === "string") out[next] = value;
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
    } else out[key] = override[key];
  }
  return out;
}

function load(lang, file) {
  const p = path.join(localesDir, lang, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}

function bundle(lang) {
  const en = mergeDeep(load("en", "common.json"), load("en", "extras.json"));
  if (lang === "en") return flatten(en);
  return flatten(mergeDeep(mergeDeep(en, load(lang, "common.json")), load(lang, "extras.json")));
}

const KEY_RE =
  /(?:^|[^A-Za-z0-9_])(?:t|tr|ts|translate)\(\s*(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\1(?:\s*,\s*(?:(["'])([\s\S]*?)\3|\{[\s\S]*?defaultValue\s*:\s*(["'])([\s\S]*?)\5))?/g;

const FRENCH =
  /[àâäéèêëïîôùûüçœÀÂÄÉÈÊËÏÎÔÙÛÜÇŒ]|\b(impossible|adresse|panier|paiement|commande|ajouter|annuler|retour|erreur|optionnel|chargement|confirmer|livraison|connecté|saisis|vérifie)\b/i;

const files = [
  ...walk(path.join(src, "screens")),
  ...walk(path.join(src, "components")),
  ...walk(path.join(src, "features")),
  ...walk(path.join(src, "navigation")),
];

const byKey = new Map();
for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const re = new RegExp(KEY_RE.source, "g");
  let m;
  while ((m = re.exec(content))) {
    const key = m[2];
    const fallback = (m[4] ?? m[6] ?? "").trim();
    if (!byKey.has(key)) byKey.set(key, { key, fallbacks: new Set(), files: new Set() });
    const row = byKey.get(key);
    if (fallback) row.fallbacks.add(fallback);
    row.files.add(path.relative(src, file).replace(/\\/g, "/"));
  }
}

const en = bundle("en");
const missing = [];
const frenchFbPresent = [];
for (const row of byKey.values()) {
  const enVal = en[row.key];
  const fb = [...row.fallbacks][0] || "";
  if (!String(enVal || "").trim()) {
    missing.push({
      key: row.key,
      fallback: fb,
      frenchFallback: !!(fb && FRENCH.test(fb)),
      files: [...row.files],
    });
  }
  if (fb && FRENCH.test(fb)) frenchFbPresent.push(row.key);
}

missing.sort((a, b) => a.key.localeCompare(b.key));
const out = {
  usedDottedKeys: byKey.size,
  missingFromEn: missing.length,
  frenchFallbackKeys: frenchFbPresent.length,
  missing,
};
fs.writeFileSync(
  path.join(root, "scripts", "extract-missing-i18n-keys.report.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(JSON.stringify({
  usedDottedKeys: byKey.size,
  missingFromEn: missing.length,
  frenchFallbackKeys: frenchFbPresent.length,
  missingSample: missing.slice(0, 40).map((m) => m.key),
}, null, 2));
