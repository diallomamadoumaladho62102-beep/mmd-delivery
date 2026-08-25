import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const i18n = read("i18n/index.ts");
const storage = read("i18n/storage.ts");
const rtl = read("i18n/rtl.ts");
const notifications = read("lib/notifications.ts");

test("global locale is source of truth", () => {
  assert.match(storage, /GLOBAL_LOCALE_KEY = "mmd_locale_global"/);
  assert.match(i18n, /setGlobalLocale\(next\)/);
  assert.match(i18n, /fallbackLng: DEFAULT_LOCALE/);
  assert.match(i18n, /DEFAULT_LOCALE = "en"/);
});

test("language change persists to profile + push token", () => {
  assert.match(i18n, /preferred_locale: next/);
  assert.match(i18n, /registerUserPushToken/);
  assert.match(notifications, /locale,/);
});

test("RTL only for Arabic", () => {
  assert.match(rtl, /isAppRtl\(\) \? "row-reverse" : "row"/);
  assert.match(storage, /return x === "ar"/);
  assert.match(i18n, /forceRTL\(wantRTL\)/);
});

test("seller is a locale role", () => {
  assert.match(storage, /seller: "mmd_locale_seller"/);
});

console.log("languageSwitch.regression.test.ts — PASS");
