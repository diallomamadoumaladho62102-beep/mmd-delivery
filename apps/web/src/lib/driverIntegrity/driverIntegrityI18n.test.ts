import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_UI_CATALOG } from "@/i18n/adminUiCatalog.generated";
import { WAIT_REASON_I18N_KEYS } from "./waitReasons";
import { pushText } from "@/lib/pushCopy";

const page = readFileSync(
  join(process.cwd(), "app/admin/driver-integrity/page.tsx"),
  "utf8"
);

const REQUIRED = [
  "Driver Integrity",
  "Active warnings",
  "Drivers without progress",
  "Reassigned orders",
  "Incidents",
  "Reviews",
  "Communications",
  "Sanctions",
  "Disputes",
  "Restaurant delay",
  "Order issue",
  "Traffic",
  "GPS issue",
  "Technical issue",
  "Vehicle issue",
  "Safety issue",
  "Other",
  "Contact driver",
  "Monitoring enabled",
  "Warning notifications enabled",
  "Automatic reassignment enabled",
  "Start masked call",
  "Wait reasons",
  "Assignment history",
  "Voice",
];

test("admin page uses useAdminT and has no hardcoded warning copy", () => {
  assert.match(page, /useAdminT/);
  assert.doesNotMatch(
    page,
    /We have not detected any progress on this delivery/
  );
});

test("catalog covers driver integrity chrome in 6 locales", () => {
  for (const key of REQUIRED) {
    const entry = ADMIN_UI_CATALOG[key];
    assert.ok(entry, `missing catalog key ${key}`);
    for (const locale of ["fr", "es", "ar", "zh", "ff"] as const) {
      assert.ok(entry[locale]?.trim(), `${key}/${locale}`);
      assert.notEqual(entry[locale], key);
    }
  }
});

test("wait reason labels are catalog keys", () => {
  for (const label of Object.values(WAIT_REASON_I18N_KEYS)) {
    assert.ok(ADMIN_UI_CATALOG[label], label);
  }
});

test("push warnings are translated for all 6 locales", () => {
  const en = pushText("driver_integrity_warning", "en");
  for (const locale of ["fr", "es", "ar", "zh", "ff"] as const) {
    const copy = pushText("driver_integrity_warning", locale);
    assert.notEqual(copy.body, en.body, locale);
    const finalCopy = pushText("driver_integrity_final_warning", locale);
    assert.ok(finalCopy.body.trim().length > 10);
  }
});
