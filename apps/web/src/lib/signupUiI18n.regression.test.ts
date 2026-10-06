import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_UI_CATALOG } from "../i18n/adminUiCatalog.generated";

const root = path.join(process.cwd());
const files = [
  "app/signup/client/page.tsx",
  "app/signup/driver/page.tsx",
  "app/signup/restaurant/page.tsx",
  "app/login/page.tsx",
  "app/seller/page.tsx",
];
const locales = ["fr", "es", "ar", "zh", "ff"] as const;
const re = /(?<![\w.])t\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(source, /\bset(?:Err|Message|Success)\("/);
  const keys = [...source.matchAll(re)].map((match) => match[1]);
  assert.ok(keys.length > 5, `${file} has too few translated strings`);
  for (const key of keys) {
    if (key.length < 2) continue;
    const entry = ADMIN_UI_CATALOG[key];
    assert.ok(entry, `${file} missing catalog entry: ${key}`);
    for (const locale of locales) {
      assert.ok(entry[locale] && entry[locale].trim().length > 0, `${locale} empty for ${key}`);
    }
  }
}

console.log("signupUiI18n.regression.test.ts — PASS");
