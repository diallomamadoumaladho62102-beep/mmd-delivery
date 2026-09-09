/**
 * Scan web/admin TSX for remaining user-facing hardcoded literals
 * outside t() / adminT() / adminNavLabel() / adminShellT().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  path.join(root, "app"),
  path.join(root, "src", "components"),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "api") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\b(?:t|adminT|adminNavLabel|adminShellT|i18n\.t)\(\s*(["'`])(?:\\.|(?!\1).)*\1(?:\s*,[\s\S]*?)?\)/g, "/*i18n*/");
}

const ALLOW = new Set([
  "MMD",
  "MMD+",
  "MMD Delivery",
  "OK",
  "SMS",
  "GPS",
  "ID",
  "USD",
  "Stripe",
  "US",
  "GN",
  "ON",
  "OFF",
]);

function isAllowed(text) {
  const t = text.trim();
  if (!t || t.length < 3) return true;
  if (ALLOW.has(t)) return true;
  if (/^[\d\s$€.,:%+\-–—/()#]+$/.test(t)) return true;
  if (/[{`]/.test(t)) return true;
  if (/^https?:/.test(t)) return true;
  if (/@/.test(t) && /\.(com|delivery|example)/i.test(t)) return true;
  if (/component$/i.test(t)) return true;
  if (/^(PNG|SVG|uuid|READY|W-9|TIN|SSN|EIN|CODEPROMO)$/.test(t)) return true;
  if (/marketplace_delivery_job_id/.test(t)) return true;
  if (/Array\.from|Boolean\(|ReactNode/.test(t)) return true;
  if (/^[•*]+$/.test(t) || t === "••••••" || t === "••••••••") return true;
  return false;
}

const files = [];
for (const t of TARGETS) walk(t, files);
const findings = [];

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const src = strip(fs.readFileSync(file, "utf8"));
  const re = />\s*([A-ZÀ-ÖØ-Þ][^<{]{2,90}?)\s*</g;
  let m;
  while ((m = re.exec(src))) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (isAllowed(text)) continue;
    findings.push({
      file: rel,
      kind: "jsx",
      text,
      line: src.slice(0, m.index).split(/\n/).length,
    });
  }
  const ph = /\bplaceholder\s*=\s*(["'])([^"'{}]{2,80})\1/g;
  while ((m = ph.exec(src))) {
    const text = m[2].trim();
    if (isAllowed(text)) continue;
    findings.push({
      file: rel,
      kind: "placeholder",
      text,
      line: src.slice(0, m.index).split(/\n/).length,
    });
  }
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}

const report = {
  filesInspected: files.length,
  findingCount: findings.length,
  filesWithFindings: byFile.size,
  top: [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 30)
    .map(([file, items]) => ({
      file,
      count: items.length,
      sample: items.slice(0, 6),
    })),
};

fs.writeFileSync(
  path.join(root, "src", "i18n", "web-hardcoded-ui-scan.json"),
  JSON.stringify({ ...report, all: findings.slice(0, 400) }, null, 2),
);
console.log(JSON.stringify({
  filesInspected: files.length,
  findingCount: findings.length,
  filesWithFindings: byFile.size,
  top: report.top.map((x) => `${x.count} ${x.file}`),
}, null, 2));
