/**
 * Replace French defaultValues in screens/components with English catalog values
 * so lang=en never leaks French when a key is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const localesDir = path.join(src, "i18n", "locales");

const PHRASES = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "i18n-screen-phrase-map.json"), "utf8"),
);
const FR_TO_EN = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "i18n-screen-fr-to-en.json"), "utf8"),
);

const FRENCH =
  /[àâäéèêëïîôùûüçœÀÂÄÉÈÊËÏÎÔÙÛÜÇŒ]|\b(impossible|adresse|panier|paiement|commande|ajouter|annuler|retour|erreur|optionnel|chargement|confirmer|livraison|connecté|connexion|reconnecte|saisis|vérifie|réessaie|aucun|boîte|entre |sélectionne|autorise|profil|course|chauffeur|client|restaurant)\b/i;

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

const en = flatten(
  mergeDeep(
    JSON.parse(fs.readFileSync(path.join(localesDir, "en", "common.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(localesDir, "en", "extras.json"), "utf8")),
  ),
);

function englishOf(key, fallback) {
  if (key === "common.error.title") return "Error";
  if (typeof en[key] === "string" && en[key].trim()) return en[key];
  if (PHRASES[fallback]?.en) return PHRASES[fallback].en;
  if (FR_TO_EN[fallback]) return FR_TO_EN[fallback];
  return "";
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const files = [
  ...walk(path.join(src, "screens")),
  ...walk(path.join(src, "components")),
  ...walk(path.join(src, "features")),
  ...walk(path.join(src, "navigation")),
];

let filesChanged = 0;
let replacements = 0;

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  const original = content;

  const pairRe =
    /((?:t|tr|ts|translate)\(\s*)(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\2(\s*,\s*)(["'])([\s\S]*?)\5/g;
  content = content.replace(pairRe, (full, prefix, q1, key, mid, q2, fallback) => {
    if (!FRENCH.test(fallback)) return full;
    const enVal = englishOf(key, fallback);
    if (!enVal || enVal === fallback) return full;
    replacements += 1;
    const safe = enVal.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    return `${prefix}${q1}${key}${q1}${mid}${q2 === "'" ? "'" : '"'}${q2 === "'" ? safe : enVal.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}${q2}`;
  });

  const dvRe =
    /((?:t|tr|ts|translate)\(\s*)(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\2([\s\S]{0,180}?defaultValue\s*:\s*)(["'])([\s\S]*?)\5/g;
  content = content.replace(dvRe, (full, prefix, q1, key, mid, q2, fallback) => {
    if (!FRENCH.test(fallback)) return full;
    const enVal = englishOf(key, fallback);
    if (!enVal || enVal === fallback) return full;
    replacements += 1;
    const escaped =
      q2 === "'"
        ? enVal.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
        : enVal.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${prefix}${q1}${key}${q1}${mid}${q2}${escaped}${q2}`;
  });

  // common.error.title → common.error (string parent)
  if (content.includes("common.error.title")) {
    content = content.replace(/common\.error\.title/g, "common.error");
    replacements += 1;
  }

  if (content !== original) {
    fs.writeFileSync(file, content, "utf8");
    filesChanged += 1;
  }
}

console.log(JSON.stringify({ ok: true, filesChanged, replacements }, null, 2));
void escapeRe;
