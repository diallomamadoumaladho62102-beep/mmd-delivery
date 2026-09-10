/**
 * Ingest every used screen/component i18n key into extras (6 locales).
 * Reuses existing catalog translations, phrase map, and FR→EN map.
 * Replaces leftover English copies when a real translation exists.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INTENTIONAL, isIntentional } from "./i18n-shared.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(root, "src", "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"];
const SKIP_NEST = new Set(["common.error.title"]);

const PHRASES = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "i18n-screen-phrase-map.json"), "utf8"),
);
const FR_TO_EN = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "i18n-screen-fr-to-en.json"), "utf8"),
);
const MISSING = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "extract-missing-i18n-keys.report.json"), "utf8"),
).missing;

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
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
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

function bundleFlat(lang) {
  const en = mergeDeep(load("en", "common.json"), load("en", "extras.json"));
  if (lang === "en") return flatten(en);
  return flatten(mergeDeep(mergeDeep(en, load(lang, "common.json")), load(lang, "extras.json")));
}

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

function parentIsString(flat, dotted) {
  const parts = dotted.split(".");
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join(".");
    if (typeof flat[parent] === "string") return true;
  }
  return false;
}

function englishOf(fallback) {
  if (!fallback) return "";
  if (PHRASES[fallback]?.en) return PHRASES[fallback].en;
  if (FR_TO_EN[fallback]) return FR_TO_EN[fallback];
  return fallback;
}

function buildReverse() {
  const en = bundleFlat("en");
  const maps = {};
  for (const lang of LANGS.filter((l) => l !== "en")) {
    maps[lang] = {};
    const loc = bundleFlat(lang);
    for (const [key, ev] of Object.entries(en)) {
      const lv = loc[key];
      if (typeof ev === "string" && typeof lv === "string" && lv && lv !== ev) {
        maps[lang][ev] = lv;
      }
    }
  }
  return maps;
}

const PHRASE_BY_EN = {};
for (const [src, row] of Object.entries(PHRASES)) {
  PHRASE_BY_EN[src] = row;
  if (row.en) PHRASE_BY_EN[row.en] = row;
}
const EN_TO_FR = Object.fromEntries(
  Object.entries(FR_TO_EN).map(([fr, en]) => [en, fr]),
);

function translate(en, lang, reverse) {
  if (!en) return "";
  if (lang === "en") return en;
  const phrase = PHRASE_BY_EN[en];
  if (phrase?.[lang]) return phrase[lang];
  if (lang === "fr" && EN_TO_FR[en]) return EN_TO_FR[en];
  if (reverse[lang]?.[en]) return reverse[lang][en];
  return "";
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
      if (cur == null || cur === "") {
        target[k] = v;
        added += 1;
      } else if (enVal != null && cur === enVal && v !== enVal) {
        target[k] = v;
        added += 1;
      }
    }
  }
  return added;
}

const reverse = buildReverse();
const bundles = Object.fromEntries(LANGS.map((l) => [l, bundleFlat(l)]));
const enFlat = bundles.en;
const extrasTrees = Object.fromEntries(LANGS.map((l) => [l, {}]));
const commonTrees = Object.fromEntries(LANGS.map((l) => [l, {}]));

function homeFile(dotted) {
  const extras = flatten(load("en", "extras.json"));
  const common = flatten(load("en", "common.json"));
  if (extras[dotted] != null) return "extras";
  if (common[dotted] != null) return "common";
  return "extras";
}

let skippedNest = 0;
for (const row of MISSING) {
  if (SKIP_NEST.has(row.key) || parentIsString(enFlat, row.key)) {
    skippedNest += 1;
    continue;
  }
  const en = englishOf(row.fallback) || row.key;
  const file = homeFile(row.key);
  const trees = file === "common" ? commonTrees : extrasTrees;
  for (const lang of LANGS) {
    const translated = translate(en, lang, reverse) || (lang === "en" ? en : "");
    if (!translated) continue;
    setPath(trees[lang], row.key, translated);
  }
  // Always write EN
  setPath(trees.en, row.key, en);
}

// Leftover English on keys that already exist: fill from phrase/reverse maps.
const usedKeys = new Set(MISSING.map((m) => m.key));
const extractUsed = JSON.parse(
  fs.readFileSync(path.join(root, "scripts", "extract-missing-i18n-keys.report.json"), "utf8"),
);
void extractUsed;

function walkUsedKeysFromAudit() {
  const src = path.join(root, "src");
  const KEY_RE =
    /(?:^|[^A-Za-z0-9_])(?:t|tr|ts|translate)\(\s*(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\1/g;
  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const files = ["screens", "components", "features", "navigation"].flatMap((d) =>
    walk(path.join(src, d)),
  );
  const keys = new Set();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const re = new RegExp(KEY_RE.source, "g");
    let m;
    while ((m = re.exec(content))) keys.add(m[2]);
  }
  return keys;
}

const allUsed = walkUsedKeysFromAudit();
let leftoverFilled = 0;
for (const key of allUsed) {
  if (SKIP_NEST.has(key) || parentIsString(enFlat, key)) continue;
  const enVal = enFlat[key] || extrasTrees.en && (() => {
    const parts = key.split(".");
    let cur = extrasTrees.en;
    for (const p of parts) cur = cur?.[p];
    return typeof cur === "string" ? cur : "";
  })();
  if (!enVal) continue;
  if (isIntentional(enVal, "fr")) continue;
  const file = homeFile(key);
  const trees = file === "common" ? commonTrees : extrasTrees;
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const loc = bundles[lang][key];
    if (loc && loc !== enVal) continue;
    if (loc && isIntentional(enVal, lang)) continue;
    const translated = translate(enVal, lang, reverse);
    if (!translated || translated === enVal) continue;
    setPath(trees[lang], key, translated);
    leftoverFilled += 1;
  }
}

let total = 0;
for (const lang of LANGS) {
  const commonPath = path.join(localesDir, lang, "common.json");
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const common = JSON.parse(fs.readFileSync(commonPath, "utf8"));
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  const a = deepMergeFill(common, commonTrees[lang] || {}, commonTrees.en);
  const b = deepMergeFill(extras, extrasTrees[lang] || {}, extrasTrees.en);
  fs.writeFileSync(commonPath, `${JSON.stringify(common, null, 2)}\n`, "utf8");
  fs.writeFileSync(extrasPath, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  console.log(`${lang}: +${a} common, +${b} extras`);
  total += a + b;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      keysAdded: total,
      skippedNest,
      leftoverFilled,
      usedKeys: allUsed.size,
      intentionalEntries: Object.keys(INTENTIONAL).length,
    },
    null,
    2,
  ),
);
