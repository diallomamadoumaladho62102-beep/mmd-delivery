/**
 * Classify remaining admin bare-catalog hits as A/B/C/D.
 * Exit 0 only if true Category A == 0.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "src", "i18n", "adminUiCatalog.json"), "utf8")
);
const KEYS = Object.keys(catalog);

const TECH = new Set([
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
  "Off", // machine toggle sometimes; still check context
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

function stripLocalized(src) {
  return src
    .replace(/\bt\(\s*(["'`])(?:\\.|(?!\1).)*\1\s*\)/g, "/*t*/")
    .replace(/\badminT\(\s*(["'`])(?:\\.|(?!\1).)*\1\s*,/g, "/*adminT*/,")
    .replace(/\badminNavLabel\(\s*(["'`])(?:\\.|(?!\1).)*\1\s*,/g, "/*nav*/,")
    .replace(/\badminShellT\(\s*(["'`])(?:\\.|(?!\1).)*\1\s*,/g, "/*shell*/,");
}

const files = [];
for (const t of targets) walk(t, files);

const A = [];
const C = [];
const D = [];

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const src = stripLocalized(raw);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  for (const key of KEYS) {
    const quoted = src.includes(`"${key}"`) || src.includes(`'${key}'`);
    const jsx = src.includes(`>${key}<`);
    if (!quoted && !jsx) continue;

    // False positive: appears only inside comments or type unions after strip — rare
    if (TECH.has(key) || /^[A-Z]{2,3}$/.test(key)) {
      C.push({ file: rel, text: key, class: "C" });
      continue;
    }

    // Catalog key still bare — Category A unless it's clearly an API enum value context
    // Heuristic: `value: "Key"` with lowercase key often machine; our keys are Title Case mostly
    const valueCtx = new RegExp(`\\bvalue\\s*:\\s*["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["']`);
    if (valueCtx.test(src) && !new RegExp(`\\blabel\\s*:\\s*["']${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}["']`).test(src) && !jsx) {
      C.push({ file: rel, text: key, class: "C", note: "value enum" });
      continue;
    }

    A.push({ file: rel, text: key, class: "A" });
  }
}

const summary = {
  A: A.length,
  C: C.length,
  D: D.length,
  A_sample: A.slice(0, 50),
  C_sample: C.slice(0, 30),
};
fs.writeFileSync(
  path.join(root, "src", "i18n", "admin-ui-classify-remaining.json"),
  JSON.stringify({ summary, A, C }, null, 2)
);
console.log(JSON.stringify(summary, null, 2));
process.exit(A.length === 0 ? 0 : 1);
