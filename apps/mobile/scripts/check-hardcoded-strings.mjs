/**
 * Scan mobile screens for likely hardcoded UI strings.
 * Run: node scripts/check-hardcoded-strings.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.join(__dirname, "..", "src", "screens");

/** Dev-only test screen — not user-facing production UI. */
const ALLOWLIST = new Set(["LocationPickerTestScreen.tsx"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let violations = 0;

for (const file of walk(screensDir)) {
  const rel = path.relative(screensDir, file).replace(/\\/g, "/");
  const base = path.basename(file);
  if (ALLOWLIST.has(base)) continue;

  const content = fs.readFileSync(file, "utf8");
  if (!content.includes("useTranslation")) {
    console.warn(`WARN no useTranslation: ${rel}`);
    violations += 1;
  }
}

if (violations > 0) {
  console.error(`FAIL: ${violations} screen(s) without useTranslation`);
  process.exit(1);
}

console.log("PASS: hardcoded-string scan (0 warnings)");
