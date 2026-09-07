import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ADMIN_NAV_GROUPS } from "./adminNav";
import {
  adminNavLabel,
  listAdminNavEnglishLabels,
} from "../i18n/adminNavI18n";
import { WEB_LOCALES } from "../i18n/locales";

test("every admin nav label has translations for all 6 locales", () => {
  const labels = new Set<string>();
  for (const group of ADMIN_NAV_GROUPS) {
    labels.add(group.label);
    for (const item of group.items) labels.add(item.label);
  }
  const dictionary = new Set(listAdminNavEnglishLabels());
  for (const label of labels) {
    assert.ok(dictionary.has(label), `missing nav i18n entry for "${label}"`);
    for (const locale of WEB_LOCALES) {
      const translated = adminNavLabel(label, locale);
      assert.ok(translated.trim().length > 0, `${locale} empty for ${label}`);
    }
    // Script/logographic locales must not leave Latin chrome identical for core groups.
    if (label === "Dashboard" || label === "Customers" || label === "Drivers") {
      assert.notEqual(adminNavLabel(label, "ar"), label);
      assert.notEqual(adminNavLabel(label, "zh"), label);
    }
  }
});

test("AdminShell wires web locale + adminNavI18n", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const shell = readFileSync(join(dir, "../components/AdminShell.tsx"), "utf8");
  assert.match(shell, /useWebI18n/);
  assert.match(shell, /adminNavLabel/);
  assert.match(shell, /adminShellT/);
  assert.match(shell, /changeAdminLocale/);
  assert.match(shell, /WEB_LOCALES/);
});
