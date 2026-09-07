/**
 * Second-pass: wrap object literal UI labels that first pass missed.
 * Patterns: label: "X", title: "X", name: "X", text: "X", heading: "X",
 * emptyTitle/description, button labels in arrays.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "src", "i18n", "adminUiCatalog.json"), "utf8")
);
const KEYS = new Set(Object.keys(catalog));

/** Technical / non-UI codes — do not wrap (Category C). */
const SKIP_KEYS = new Set([
  "US",
  "GN",
  "ON",
  "OFF",
  "ID",
  "OK",
  "API",
  "URL",
  "USD",
  "EUR",
  "GNF",
  "MMD",
  "Stripe",
  "Twilio",
  "FAQ",
]);

const targets = [
  path.join(root, "app", "admin"),
  path.join(root, "src", "components", "admin"),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hasT(src) {
  return /\buseAdminT\s*\(/.test(src) || /\bconst\s+\{\s*t\s*\}/.test(src) || /\bconst\s+t\s*=/.test(src);
}

function ensureClientHook(src) {
  let out = src;
  if (!/^\s*["']use client["']/.test(out)) {
    out = `"use client";\n\n` + out;
  }
  if (!out.includes("@/i18n/useAdminT")) {
    out = out.replace(
      /^(\s*["']use client["']\s*;?\s*)/,
      `$1\nimport { useAdminT } from "@/i18n/useAdminT";\n`
    );
  }
  if (!/\buseAdminT\s*\(/.test(out)) {
    const m = out.match(/export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{/);
    if (m) {
      const idx = m.index + m[0].length;
      out = out.slice(0, idx) + `\n  const { t } = useAdminT();\n` + out.slice(idx);
    }
  }
  return out;
}

function wrapObjectFields(src) {
  const fieldRe =
    /\b(label|title|subtitle|name|text|heading|description|placeholder|emptyTitle|emptyDescription|buttonLabel|confirmLabel|cancelLabel|ariaLabel)\s*:\s*(["'])([^"'\\\n]+)\2/g;
  return src.replace(fieldRe, (full, field, q, value) => {
    if (SKIP_KEYS.has(value)) return full;
    if (!KEYS.has(value)) return full;
    if (full.includes("t(") || full.includes("adminT(")) return full;
    return `${field}: t("${esc(value)}")`;
  });
}

/** Wrap ternary / array string literals used as visible status chips when exact catalog match. */
function wrapStandaloneStatusLiterals(src) {
  // return "Pending"; / return 'Active';
  return src.replace(
    /\breturn\s+(["'])([^"'\\\n]+)\1\s*;/g,
    (full, q, value) => {
      if (SKIP_KEYS.has(value) || !KEYS.has(value)) return full;
      if (full.includes("t(")) return full;
      return `return t("${esc(value)}");`;
    }
  );
}

const files = walk(targets[0]).concat(walk(targets[1]));
let changed = 0;
const touched = [];

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let src = wrapObjectFields(before);
  src = wrapStandaloneStatusLiterals(src);
  if (src === before) continue;
  if (!hasT(src)) src = ensureClientHook(src);
  // If still no t in scope but we wrapped, ensure hook on default export
  if (src.includes('t("') && !hasT(src)) src = ensureClientHook(src);
  fs.writeFileSync(file, src);
  changed += 1;
  touched.push(path.relative(root, file).replace(/\\/g, "/"));
}

console.log(JSON.stringify({ changed, touchedCount: touched.length }, null, 2));
fs.writeFileSync(
  path.join(root, "src", "i18n", "admin-ui-wire-pass2-report.json"),
  JSON.stringify({ changed, touched }, null, 2)
);
