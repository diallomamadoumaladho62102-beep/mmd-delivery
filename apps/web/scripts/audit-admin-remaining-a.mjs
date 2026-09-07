/**
 * Audit remaining Category-A UI hardcodes under Admin after adminT wiring.
 * A string counts as localized if it appears only inside t("...") or adminT("...", ...).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, "src", "i18n", "adminUiCatalog.json"), "utf8")
);
const KEYS = Object.keys(catalog);

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

const findings = [];
const files = [];
for (const t of targets) walk(t, files);

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const src = stripLocalized(raw);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  for (const key of KEYS) {
    // crude presence checks for remaining bare literals
    const patterns = [
      `"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      `'${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`,
      `>${key}<`,
      `> ${key} <`,
    ];
    for (const p of patterns) {
      if (src.includes(p.replace(/\\/g, ""))) {
        // verify with includes of unescaped
      }
    }
    if (
      src.includes(`"${key}"`) ||
      src.includes(`'${key}'`) ||
      src.includes(`>${key}<`) ||
      src.includes(`>\n${key}\n<`)
    ) {
      findings.push({ file: rel, text: key });
      break; // one per file for summary; collect all below
    }
  }
}

// full unique remaining per file
const detailed = [];
for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const src = stripLocalized(raw);
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const hits = [];
  for (const key of KEYS) {
    if (
      src.includes(`"${key}"`) ||
      src.includes(`'${key}'`) ||
      src.includes(`>${key}<`)
    ) {
      hits.push(key);
    }
  }
  if (hits.length) {
    const lines = raw.split(/\r?\n/);
    const contexts = hits.map((text) => {
      const line = lines.findIndex(
        (value) =>
          value.includes(`"${text}"`) ||
          value.includes(`'${text}'`) ||
          value.includes(`>${text}<`)
      );
      return { text, line: line + 1, source: line >= 0 ? lines[line].trim() : "" };
    });
    detailed.push({ file: rel, count: hits.length, sample: hits, contexts });
  }
}

detailed.sort((a, b) => b.count - a.count);
const totalHits = detailed.reduce((n, d) => n + d.count, 0);
const out = {
  filesScanned: files.length,
  filesWithBareCatalogKeys: detailed.length,
  totalBareCatalogKeyHits: totalHits,
  top: detailed,
};
fs.writeFileSync(
  path.join(root, "src", "i18n", "admin-ui-remaining-a.json"),
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify(out, null, 2));
