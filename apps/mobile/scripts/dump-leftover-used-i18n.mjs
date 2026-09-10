import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isIntentional } from "./i18n-shared.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function flatten(obj, prefix = "", out = {}) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const n = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, n, out);
    else if (typeof v === "string") out[n] = v;
  }
  return out;
}

function merge(a, b) {
  const o = { ...(a || {}) };
  for (const k of Object.keys(b || {})) {
    if (
      b[k] &&
      typeof b[k] === "object" &&
      !Array.isArray(b[k]) &&
      o[k] &&
      typeof o[k] === "object" &&
      !Array.isArray(o[k])
    ) {
      o[k] = merge(o[k], b[k]);
    } else o[k] = b[k];
  }
  return o;
}

function load(l, f) {
  return JSON.parse(fs.readFileSync(path.join(root, "src", "i18n", "locales", l, f), "utf8"));
}

function bundle(l) {
  const en = merge(load("en", "common.json"), load("en", "extras.json"));
  if (l === "en") return flatten(en);
  return flatten(merge(merge(en, load(l, "common.json")), load(l, "extras.json")));
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(f);
  }
  return out;
}

const KEY_RE =
  /(?:^|[^A-Za-z0-9_])(?:t|tr|ts|translate)\(\s*(["'])([a-zA-Z][\w]*(?:\.[\w]+)+)\1/g;
const files = ["screens", "components", "features", "navigation"].flatMap((d) =>
  walk(path.join(root, "src", d)),
);
const used = new Set();
for (const file of files) {
  const c = fs.readFileSync(file, "utf8");
  const re = new RegExp(KEY_RE.source, "g");
  let m;
  while ((m = re.exec(c))) used.add(m[2]);
}

const en = bundle("en");
const leftover = {};
for (const lang of ["fr", "es", "ar", "zh", "ff"]) {
  const loc = bundle(lang);
  leftover[lang] = [];
  for (const key of used) {
    const ev = en[key];
    const lv = loc[key];
    if (!ev) continue;
    if (!lv || (lv === ev && ev.length > 3 && /[A-Za-z]{4,}/.test(ev) && !isIntentional(ev, lang))) {
      leftover[lang].push({ key, en: ev, loc: lv || "" });
    }
  }
}

const unique = [...new Set(Object.values(leftover).flatMap((rows) => rows.map((r) => r.en)))];
const out = {
  used: used.size,
  counts: Object.fromEntries(Object.entries(leftover).map(([k, v]) => [k, v.length])),
  unique,
  leftover,
};
fs.writeFileSync(path.join(root, "scripts", "_leftover-used.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ used: used.size, counts: out.counts, unique: unique.length }, null, 2));
console.log("sample FR", leftover.fr.slice(0, 12));
