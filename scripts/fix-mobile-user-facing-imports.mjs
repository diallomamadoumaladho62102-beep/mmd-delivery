#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "apps/mobile/src");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

function importPathFor(file) {
  const rel = path.relative(srcRoot, file);
  const depth = rel.split(path.sep).length - 1;
  return `${"../".repeat(depth)}lib/userFacingError`;
}

function ensureImport(file, content) {
  if (!content.includes("toUserFacingError")) return content;
  if (/import\s*\{[^}]*toUserFacingError[^}]*\}/.test(content)) return content;

  const importStatement = `import { toUserFacingError } from "${importPathFor(file)}";\n`;
  const match = content.match(/^import .+;\n/m);
  if (!match) return importStatement + content;
  const idx = content.indexOf(match[0]) + match[0].length;
  return content.slice(0, idx) + importStatement + content.slice(idx);
}

let changed = 0;
for (const file of walk(srcRoot)) {
  if (file.endsWith("userFacingError.ts")) continue;
  const original = fs.readFileSync(file, "utf8");
  const next = ensureImport(file, original);
  if (next !== original) {
    fs.writeFileSync(file, next, "utf8");
    changed += 1;
    console.log("import added", path.relative(repoRoot, file));
  }
}
console.log(`Done. ${changed} import(s) added.`);
