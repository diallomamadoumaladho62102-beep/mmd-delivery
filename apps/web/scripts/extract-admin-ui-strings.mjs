/**
 * Extract Category-A UI strings from admin pages + components.
 * Output: src/i18n/admin-ui-strings.extracted.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  path.join(root, "app", "admin"),
  path.join(root, "src", "components", "admin"),
  path.join(root, "src", "components", "AdminShell.tsx"),
];

const PROP_RE =
  /\b(?:title|subtitle|label|placeholder|aria-label|aria-placeholder|alt|buttonText|emptyTitle|emptyDescription|confirmLabel|cancelLabel)\s*=\s*(?:\{\s*)?["'`]([^"'`\n]{2,160})["'`]/g;
const JSX_TEXT_RE = />(\s*)([A-ZÀ-ÖØ-Þ][^<>{}/]{1,120}?)(\s*)</g;
const ALERT_RE = /(?:alert|confirm|prompt)\(\s*["'`]([^"'`]{2,160})["'`]/gi;

const SKIP = [
  /^https?:/i,
  /^\/admin/i,
  /^[a-z0-9_.-]+@[a-z]/i,
  /^[0-9]+$/,
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(/i,
  /^var\(/i,
  /^MMD Delivery$/,
  /^MMD$/,
  /^Stripe$/i,
  /^USD$/i,
  /^EUR$/i,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  if (fs.statSync(dir).isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function shouldKeep(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 160) return false;
  if (SKIP.some((re) => re.test(t))) return false;
  if (!/[A-Za-zÀ-ÿ\u0600-\u06FF\u4e00-\u9fff]/.test(t)) return false;
  if (/^[{}$]/.test(t)) return false;
  if (/^[a-z_]+$/.test(t)) return false; // likely code id
  return true;
}

const files = [];
for (const t of targets) walk(t, files);

const byString = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const add = (s, kind) => {
    const v = s.replace(/\s+/g, " ").trim();
    if (!shouldKeep(v)) return;
    if (!byString.has(v)) byString.set(v, { count: 0, files: new Set(), kinds: new Set() });
    const row = byString.get(v);
    row.count += 1;
    row.files.add(rel);
    row.kinds.add(kind);
  };

  let m;
  const propRe = new RegExp(PROP_RE.source, "g");
  while ((m = propRe.exec(text))) add(m[1], "prop");
  const jsxRe = new RegExp(JSX_TEXT_RE.source, "g");
  while ((m = jsxRe.exec(text))) add(m[2], "jsx");
  const alertRe = new RegExp(ALERT_RE.source, "gi");
  while ((m = alertRe.exec(text))) add(m[1], "alert");
}

const rows = [...byString.entries()]
  .map(([text, meta]) => ({
    text,
    count: meta.count,
    files: [...meta.files].sort(),
    kinds: [...meta.kinds].sort(),
  }))
  .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

const outPath = path.join(root, "src", "i18n", "admin-ui-strings.extracted.json");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, strings: rows }, null, 2));
console.log(`files=${files.length} uniqueStrings=${rows.length} -> ${outPath}`);
