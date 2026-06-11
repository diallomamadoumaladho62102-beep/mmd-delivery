/**
 * Apply flat translation maps to produce fully localized extras bundles.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const mapsDir = path.join(__dirname, "i18n-lang");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      override[key] &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      base[key] &&
      typeof base[key] === "object"
    ) {
      out[key] = deepMerge(base[key], override[key]);
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

function unflatten(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

function applyFlatMap(tree, flatMap) {
  const enFlat = flatten(tree);
  const nextFlat = { ...enFlat };
  for (const [key, value] of Object.entries(flatMap)) {
    if (key in nextFlat && typeof value === "string" && value.trim()) {
      nextFlat[key] = value;
    }
  }
  return unflatten(nextFlat);
}

const en = loadJson(path.join(localesDir, "en", "extras.json"));
const frCommon = loadJson(path.join(localesDir, "fr", "common.json"));

for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  let tree = en;
  if (lang !== "en") {
    const mapPath = path.join(mapsDir, `${lang}.flat.json`);
    if (fs.existsSync(mapPath)) {
      tree = applyFlatMap(en, loadJson(mapPath));
    }
  }
  if (lang === "ff") {
    tree = deepMerge(tree, { client: { auth: frCommon.client?.auth ?? {} } });
  }
  fs.writeFileSync(
    path.join(localesDir, lang, "extras.json"),
    `${JSON.stringify(tree, null, 2)}\n`,
    "utf8"
  );
  console.log("wrote", lang, "extras.json");
}
