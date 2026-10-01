import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ADMIN_UI_CATALOG } from "@/i18n/adminUiCatalog.generated";
import { adminT } from "@/i18n/adminUiI18n";
import { WEB_LOCALES, webDir, type WebLocale } from "@/i18n/locales";

const page = readFileSync(
  join(process.cwd(), "app/admin/minimum-pay/page.tsx"),
  "utf8"
);

function extractTKeys(source: string): string[] {
  const keys = new Set<string>();
  const re = /\bt\(\s*"([^"]+)"\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    keys.add(match[1]);
  }
  return [...keys];
}

test("every Minimum Pay admin t() key exists in all locales", () => {
  const keys = extractTKeys(page);
  assert.ok(keys.length > 20, "expected many t() keys");
  for (const key of keys) {
    const entry = ADMIN_UI_CATALOG[key];
    assert.ok(entry, `missing catalog key: ${key}`);
    for (const locale of WEB_LOCALES) {
      const translated = adminT(key, locale as WebLocale);
      assert.ok(String(translated).trim().length > 0, `${locale} empty for ${key}`);
    }
    for (const locale of ["fr", "es", "ar", "zh", "ff"] as const) {
      const localized = entry[locale];
      assert.ok(
        typeof localized === "string" && localized.trim().length > 0,
        `${locale} catalog missing for ${key}`
      );
      const translated = adminT(key, locale);
      assert.equal(
        translated,
        localized,
        `${locale} unexpectedly fell back for ${key}`
      );
    }
  }
});

test("arabic admin locale is rtl and other MMD locales stay ltr", () => {
  assert.equal(webDir("ar"), "rtl");
  for (const locale of ["en", "fr", "es", "zh", "ff"] as const) {
    assert.equal(webDir(locale), "ltr");
  }
});

test("Minimum Pay admin page does not hardcode user-facing JSX copy", () => {
  const withoutT = page.replace(/\bt\(\s*"[^"]+"\s*\)/g, "t()");
  assert.doesNotMatch(withoutT, />\s*Minimum Pay\s*</);
  assert.doesNotMatch(withoutT, />\s*Pay Period\s*</);
  assert.doesNotMatch(withoutT, />\s*Hourly Rate\s*</);
  assert.doesNotMatch(withoutT, />\s*Enregistrer\s*</);
  assert.doesNotMatch(withoutT, />\s*Save\s*</);
  assert.doesNotMatch(withoutT, />\s*Cancel\s*</);
});
