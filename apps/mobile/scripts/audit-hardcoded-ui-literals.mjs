/**
 * Broader UI literal scan (titles/labels/placeholders/common actions).
 * Distinguishes likely MMD chrome from commercial/content placeholders.
 * Run: node scripts/audit-hardcoded-ui-literals.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");

const SKIP_DIR = new Set(["node_modules", "__tests__", "i18n"]);
const SKIP_FILE = /\.(test|spec)\.(tsx?|jsx?)$/;

/** Placeholders that are examples / geo / brand-ish, not chrome. */
const CONTENT_ALLOW = [
  /^New York$/i,
  /^Matoto$/i,
  /^Lambanyi$/i,
  /^Ex:/i,
  /^Station Total/i,
  /^Main St/i,
  /^After Total/i,
  /^1112 /i,
  /^MMD /i,
  /^https?:/i,
];

const PROP_RE =
  /\b(title|subtitle|label|placeholder|accessibilityLabel|accessibilityHint)\s*=\s*(?:\{)?["'`]([^"'`]{2,120})["'`]/g;
const LITERAL_ACTION_RE =
  /["'`](Log out|Log in|Login|Sign in|Sign up|Cancel|Continue|Next|Previous|Back|Save|Hide|Show|View|Forgot password\s*\??|Offline|More options|Get estimate|Settings|Wallet|History|Retry|Close|Accept|Prepared|Ready|Loading\.{0,3}|Identity Verification|Order Automation|Promotions|Vehicle|Driver Setup)["'`]/gi;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(entry.name) && !SKIP_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

function isContentAllow(text) {
  return CONTENT_ALLOW.some((re) => re.test(text.trim()));
}

const files = walk(srcRoot);
const findings = [];

for (const file of files) {
  const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
  const text = fs.readFileSync(file, "utf8");
  let m;
  const propRe = new RegExp(PROP_RE.source, "g");
  while ((m = propRe.exec(text))) {
    const prop = m[1];
    const value = m[2];
    if (isContentAllow(value)) continue;
    if (/^\{\{/.test(value)) continue;
    if (/^[a-z0-9_.-]+$/i.test(value) && value.includes(".")) continue; // likely i18n key
    // Ignore pure numbers / symbols
    if (!/[A-Za-zÀ-ÿ\u0600-\u06FF\u4e00-\u9fff]/.test(value)) continue;
    findings.push({ file: rel, kind: `prop:${prop}`, value });
  }
  const actRe = new RegExp(LITERAL_ACTION_RE.source, "gi");
  while ((m = actRe.exec(text))) {
    findings.push({ file: rel, kind: "action", value: m[1] });
  }
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

console.log(
  JSON.stringify(
    {
      filesScanned: files.length,
      findingCount: findings.length,
      filesWithFindings: byFile.size,
    },
    null,
    2,
  ),
);

const top = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 50);
for (const [file, rows] of top) {
  const sample = [...new Set(rows.map((r) => r.value))].slice(0, 10).join(" | ");
  console.log(`${rows.length}\t${file}\t${sample}`);
}

if (process.argv.includes("--fail")) {
  // Soft gate for release: fail only on high-confidence chrome actions in screens/
  const chrome = findings.filter(
    (f) =>
      f.kind === "action" &&
      (f.file.startsWith("screens/") || f.file.startsWith("components/navigation/")),
  );
  if (chrome.length > 0) {
    console.error(`FAIL: ${chrome.length} chrome action literal(s)`);
    for (const c of chrome.slice(0, 40)) {
      console.error(` - ${c.file}: ${c.value}`);
    }
    process.exit(1);
  }
  console.log("PASS: no high-confidence chrome action literals in screens/navigation");
}
