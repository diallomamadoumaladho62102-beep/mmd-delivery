/**
 * Fill leftover-English used keys from phrase maps (does not overwrite real translations).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIntentional } from "./i18n-shared.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(root, "src", "i18n", "locales");
const LANGS = ["fr", "es", "ar", "zh", "ff"];

const PHRASES = {
  ...JSON.parse(fs.readFileSync(path.join(root, "scripts", "i18n-screen-phrase-map.json"), "utf8")),
  ...JSON.parse(fs.readFileSync(path.join(root, "scripts", "i18n-leftover-phrase-map.json"), "utf8")),
};
const FR_TO_EN = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "i18n-screen-fr-to-en.json"), "utf8"),
);
const EN_TO_FR = Object.fromEntries(Object.entries(FR_TO_EN).map(([fr, en]) => [en, fr]));
const leftoverReport = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "_leftover-used.json"), "utf8"),
);

function setPath(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur[part] == null || typeof cur[part] !== "object" || Array.isArray(cur[part])) {
      cur[part] = {};
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function deepMergeFill(target, source, english) {
  let added = 0;
  for (const [k, v] of Object.entries(source)) {
    if (v != null && typeof v === "object" && !Array.isArray(v)) {
      if (target[k] == null || typeof target[k] !== "object" || Array.isArray(target[k])) {
        target[k] = {};
      }
      added += deepMergeFill(
        target[k],
        v,
        english && typeof english === "object" ? english[k] : undefined,
      );
    } else if (typeof v === "string") {
      const cur = target[k];
      const enVal = typeof english?.[k] === "string" ? english[k] : undefined;
      if (cur == null || cur === "" || (enVal != null && cur === enVal && v !== enVal)) {
        target[k] = v;
        added += 1;
      }
    }
  }
  return added;
}

function translate(en, lang) {
  const row = PHRASES[en];
  if (row?.[lang]) return row[lang];
  if (lang === "fr" && EN_TO_FR[en]) return EN_TO_FR[en];
  return "";
}

const trees = Object.fromEntries(LANGS.map((l) => [l, {}]));
const enTree = {};
let planned = 0;
for (const lang of LANGS) {
  for (const row of leftoverReport.leftover[lang] || []) {
    if (isIntentional(row.en, lang)) continue;
    const translated = translate(row.en, lang);
    if (!translated || translated === row.en) continue;
    setPath(trees[lang], row.key, translated);
    setPath(enTree, row.key, row.en);
    planned += 1;
  }
}

let total = 0;
for (const lang of LANGS) {
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  const n = deepMergeFill(extras, trees[lang], enTree);
  fs.writeFileSync(extrasPath, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  console.log(`${lang}: +${n} extras`);
  total += n;
}
console.log(JSON.stringify({ ok: true, planned, keysAdded: total }, null, 2));
