#!/usr/bin/env node
/**
 * Normalize user-visible mobile errors to toUserFacingError().
 * Run once: node scripts/normalize-mobile-user-errors.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  path.join(repoRoot, "apps/mobile/src/screens"),
  path.join(repoRoot, "apps/mobile/src/components"),
  path.join(repoRoot, "apps/mobile/src/hooks"),
  path.join(repoRoot, "apps/mobile/src/features"),
];

const importLine = 'import { toUserFacingError } from "../lib/userFacingError";';
const importLineNested = (depth) =>
  `import { toUserFacingError } from "${ "../".repeat(depth) }lib/userFacingError";`;

function relativeImportDepth(filePath) {
  const rel = path.relative(path.join(repoRoot, "apps/mobile/src"), filePath);
  const depth = rel.split(path.sep).length - 1;
  return depth;
}

function ensureImport(content, filePath) {
  if (content.includes("toUserFacingError")) return content;
  const depth = relativeImportDepth(filePath);
  const line =
    depth <= 1
      ? importLine.replace("../", depth === 0 ? "./" : "../")
      : importLineNested(depth);

  const importMatch = content.match(/^import .+;\n/m);
  if (!importMatch) return line + "\n" + content;
  const idx = content.indexOf(importMatch[0]) + importMatch[0].length;
  return content.slice(0, idx) + line + "\n" + content.slice(idx);
}

function transform(content) {
  let next = content;

  next = next.replace(
    /Alert\.alert\(([^,]+),\s*error\.message\s*\)/g,
    "Alert.alert($1, toUserFacingError(error, \"Une action temporairement impossible s'est produite. Veuillez réessayer.\"))",
  );
  next = next.replace(
    /Alert\.alert\(([^,]+),\s*authErr\.message\s*\)/g,
    "Alert.alert($1, toUserFacingError(authErr, \"Identifiants incorrects. Vérifiez votre email et mot de passe.\"))",
  );
  next = next.replace(
    /Alert\.alert\(([^,]+),\s*e\?\.message\s*\?\?\s*([^)]+)\)/g,
    "Alert.alert($1, toUserFacingError(e, $2))",
  );
  next = next.replace(
    /Alert\.alert\("Erreur", error instanceof Error \? error\.message : ([^)]+)\)/g,
    'Alert.alert("Erreur", toUserFacingError(error, $1))',
  );
  next = next.replace(
    /Alert\.alert\(([^,]+),\s*error instanceof Error \? error\.message : ([^)]+)\)/g,
    "Alert.alert($1, toUserFacingError(error, $2))",
  );
  next = next.replace(
    /Alert\.alert\(([^,]+),\s*e instanceof Error \? e\.message : ([^)]+)\)/g,
    "Alert.alert($1, toUserFacingError(e, $2))",
  );
  next = next.replace(
    /e instanceof Error \? e\.message : ([^;\n,)]+)/g,
    "toUserFacingError(e, $1)",
  );
  next = next.replace(
    /err instanceof Error \? err\.message : ([^;\n,)]+)/g,
    "toUserFacingError(err, $1)",
  );
  next = next.replace(
    /error instanceof Error \? error\.message : ([^;\n,)]+)/g,
    "toUserFacingError(error, $1)",
  );
  next = next.replace(
    /throw new Error\(error\.message(?: \|\| ([^)]+))?\)/g,
    (_m, fallback) =>
      fallback
        ? `throw new Error(toUserFacingError(error, ${fallback}))`
        : `throw new Error(toUserFacingError(error, "Une action temporairement impossible s'est produite. Veuillez réessayer."))`,
  );

  return next;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

let changed = 0;
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    if (file.includes("userFacingError")) continue;
    const original = fs.readFileSync(file, "utf8");
    const transformed = transform(original);
    if (transformed === original) continue;
    const withImport = ensureImport(transformed, file);
    fs.writeFileSync(file, withImport, "utf8");
    changed += 1;
    console.log("updated", path.relative(repoRoot, file));
  }
}

console.log(`Done. ${changed} file(s) updated.`);
