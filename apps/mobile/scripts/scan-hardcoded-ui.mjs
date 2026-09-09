/**
 * Exhaustive scan of remaining user-facing hardcoded literals in mobile TSX.
 * Reports JSX text, placeholders, Alert titles, and accessibility labels
 * that are not wrapped in t()/tr()/ts().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

const SKIP_DIRS = new Set(["node_modules", "__tests__", "i18n"]);
const SKIP_FILES = /\.(test|spec)\.(tsx?|jsx?)$/;

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, out);
    } else if (/\.(tsx|jsx)$/.test(name) && !SKIP_FILES.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Remove t("..."), t('...'), tr("..."), ts("...") including defaultValue args. */
function stripI18nCalls(src) {
  return src
    .replace(/\b(?:t|tr|ts|i18n\.t)\(\s*(["'`])(?:\\.|(?!\1).)*\1(?:\s*,[\s\S]*?)?\)/g, "/*i18n*/");
}

const JSX_TEXT = />\s*([A-ZÀ-ÖØ-Þ][^<{]{2,80}?)\s*</g;
const PLACEHOLDER = /\bplaceholder\s*=\s*(["'])([^"'{}]{2,80})\1/g;
const A11Y = /\baccessibilityLabel\s*=\s*(["'])([^"'{}]{2,80})\1/g;
const ALERT = /Alert\.alert\(\s*(["'])([^"'\\]{2,80})\1/g;
const TITLE_PROP = /\b(?:title|subtitle|label|message|description|confirmText|cancelText|submitLabel)\s*=\s*(["'])([A-Za-zÀ-ÿ][^"'{}]{2,80})\1/g;

const ALLOW_TEXT = new Set([
  "MMD",
  "MMD+",
  "MMD Delivery",
  "MMD DELIVERY",
  "MMD Smart Dispatch",
  "OK",
  "SMS",
  "GPS",
  "ID",
  "ETA",
  "PDF",
  "USD",
  "SSN",
  "EIN",
  "Stripe",
  "Apple Pay",
  "MMD Taxi",
  "XL",
]);

function isAllowed(text) {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (ALLOW_TEXT.has(t)) return true;
  if (/^[\d\s$€.,:%+\-–—/()#*•*]+$/.test(t)) return true;
  if (/^[•*]+$/.test(t) || t === "********" || t === "••••••••") return true;
  if (/^[{}`]/.test(t)) return true;
  if (/^https?:/.test(t)) return true;
  if (/^[A-Z0-9_\-.]{2,12}$/.test(t) && t.includes("_")) return true;
  if (/DEV:/.test(t)) return true;
  if (/\b(Math\.|Date\.now|Promise|Number\(|const \[)/.test(t)) return true;
  return false;
}

const files = walk(srcDir);
const findings = [];
let filesInspected = 0;

for (const file of files) {
  filesInspected += 1;
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const raw = fs.readFileSync(file, "utf8");
  const src = stripI18nCalls(stripComments(raw));
  const lines = src.split(/\r?\n/);

  function add(kind, text, idx) {
    const trimmed = String(text).replace(/\s+/g, " ").trim();
    if (isAllowed(trimmed)) return;
    if (/\{/.test(trimmed)) return;
    findings.push({ file: rel, kind, text: trimmed, line: idx + 1 });
  }

  let m;
  const jsx = new RegExp(JSX_TEXT.source, "g");
  while ((m = jsx.exec(src))) add("jsx", m[1], src.slice(0, m.index).split(/\n/).length - 1);

  const ph = new RegExp(PLACEHOLDER.source, "g");
  while ((m = ph.exec(src))) add("placeholder", m[2], src.slice(0, m.index).split(/\n/).length - 1);

  const a11y = new RegExp(A11Y.source, "g");
  while ((m = a11y.exec(src))) add("a11y", m[2], src.slice(0, m.index).split(/\n/).length - 1);

  const al = new RegExp(ALERT.source, "g");
  while ((m = al.exec(src))) add("alert", m[2], src.slice(0, m.index).split(/\n/).length - 1);

  const tp = new RegExp(TITLE_PROP.source, "g");
  while ((m = tp.exec(src))) add("prop", m[2], src.slice(0, m.index).split(/\n/).length - 1);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bdefaultValue\s*[:=]\s*["'][A-Za-zÀ-ÿ]/.test(line) && !/\/\*i18n\*\//.test(line)) {
      const dm = line.match(/defaultValue\s*[:=]\s*(["'])([^"'\\]{3,80})\1/);
      if (dm && !isAllowed(dm[2])) add("defaultValue", dm[2], i);
    }
  }
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const report = {
  filesInspected,
  findingCount: findings.length,
  filesWithFindings: byFile.size,
  top: [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 40)
    .map(([file, items]) => ({
      file,
      count: items.length,
      sample: items.slice(0, 8),
    })),
  all: findings.slice(0, 400),
};

const outPath = path.join(root, "scripts", "hardcoded-ui-scan.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      filesInspected,
      findingCount: findings.length,
      filesWithFindings: byFile.size,
      top: report.top.map((x) => `${x.count} ${x.file}`),
    },
    null,
    2,
  ),
);
