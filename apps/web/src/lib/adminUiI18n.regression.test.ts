/**
 * Admin UI i18n regression: catalog coverage + adminT for 6 locales + shell/nav.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminT } from "../i18n/adminUiI18n";
import { ADMIN_UI_CATALOG } from "../i18n/adminUiCatalog.generated";
import {
  adminNavLabel,
  listAdminNavEnglishLabels,
} from "../i18n/adminNavI18n";
import { WEB_LOCALES, webT, type WebLocale } from "../i18n/locales";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const NON_EN: Exclude<WebLocale, "en">[] = ["fr", "es", "ar", "zh", "ff"];

const SPOT = [
  "Save",
  "Cancel",
  "Refresh",
  "Search",
  "Loading…",
  "Status",
  "Actions",
  "Delete",
  "Client",
  "Driver",
];

test("adminT resolves spot-check chrome for all 6 locales", () => {
  for (const key of SPOT) {
    assert.ok(ADMIN_UI_CATALOG[key], `missing catalog key ${key}`);
    assert.equal(adminT(key, "en"), key);
    for (const locale of NON_EN) {
      const entry = ADMIN_UI_CATALOG[key];
      const translated = adminT(key, locale);
      assert.ok(translated.length > 0, `${key}/${locale} empty`);
      if (entry?.[locale]) {
        assert.equal(translated, entry[locale], `${key}/${locale}`);
        if (entry[locale] !== key) {
          assert.notEqual(translated, key, `${key} should translate for ${locale}`);
        }
      }
    }
  }
});

test("French source keys resolve to English when locale=en", () => {
  assert.equal(adminT("Chargement…", "en"), "Loading…");
  assert.equal(adminT("Enregistrer", "en"), "Save");
  assert.equal(adminT("Actualiser", "en"), "Refresh");
});

test("nav labels remain covered for all locales", () => {
  for (const label of listAdminNavEnglishLabels()) {
    for (const locale of WEB_LOCALES) {
      const out = adminNavLabel(label, locale);
      assert.ok(out.length > 0, `nav ${label}/${locale}`);
    }
  }
});

test("AdminShell keeps locale cookie + RTL dir wiring", () => {
  const shell = fs.readFileSync(
    path.join(root, "components", "AdminShell.tsx"),
    "utf8"
  );
  assert.match(shell, /useWebI18n/);
  assert.match(shell, /dir=\{dir\}/);
  assert.match(shell, /mmd_web_locale/);
  assert.match(shell, /adminNavLabel/);
  assert.match(shell, /adminShellT/);
});

test("useAdminT is wired across admin pages/components", () => {
  const useAdminTSrc = fs.readFileSync(
    path.join(root, "i18n", "useAdminT.ts"),
    "utf8"
  );
  assert.match(useAdminTSrc, /adminT/);
  assert.match(useAdminTSrc, /useWebI18n/);

  let wired = 0;
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) {
        const txt = fs.readFileSync(full, "utf8");
        if (txt.includes("useAdminT") || txt.includes("adminT(")) wired += 1;
      }
    }
  }
  walk(path.join(root, "..", "app", "admin"));
  walk(path.join(root, "components", "admin"));
  assert.ok(wired >= 80, `expected many admin files wired, got ${wired}`);
});

test("receipt chrome is localized for all 6 locales", () => {
  for (const locale of WEB_LOCALES) {
    assert.notEqual(webT("taxi.receipt.title", locale), "taxi.receipt.title");
    assert.notEqual(webT("order.receipt.title", locale), "order.receipt.title");
    if (locale !== "en") {
      assert.notEqual(
        webT("taxi.receipt.loading", locale),
        webT("taxi.receipt.loading", "en"),
        `taxi receipt should not stay English for ${locale}`
      );
    }
  }
});

test("every admin catalog key has fr, es, ar, zh, ff", () => {
  const missing: string[] = [];
  for (const [key, entry] of Object.entries(ADMIN_UI_CATALOG)) {
    for (const locale of NON_EN) {
      const value = entry?.[locale];
      if (typeof value !== "string" || value.length === 0) {
        missing.push(`${key}/${locale}`);
      }
    }
  }
  assert.equal(missing.length, 0, `missing locales: ${missing.slice(0, 20).join(", ")}`);
});
