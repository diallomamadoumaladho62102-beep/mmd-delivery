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
  assert.match(notifications, /getGlobalLocale/);
  assert.match(notifications, /locale,/);
});

test("boot locale sync writes preferred_locale so email/SMS are not stuck on en", () => {
  assert.match(i18n, /export async function syncLocaleForRole/);
  const syncFn = i18n.slice(i18n.indexOf("export async function syncLocaleForRole"));
  assert.match(syncFn, /preferred_locale: next/);
});

test("RTL only for Arabic", () => {
  assert.match(rtl, /isAppRtl\(\) \? "row-reverse" : "row"/);
  assert.match(storage, /return x === "ar"/);
  assert.match(i18n, /forceRTL\(wantRTL\)/);
});

test("seller is a locale role", () => {
  assert.match(storage, /seller: "mmd_locale_seller"/);
});

test("all six app languages are allowed", () => {
  assert.match(i18n, /ALLOWED_LOCALES = new Set\(\["en", "fr", "es", "ar", "zh", "ff"\]\)/);
  for (const code of ["en", "fr", "es", "ar", "zh", "ff"]) {
    assert.ok(
      fs.existsSync(path.join(root, "i18n", "locales", code, "common.json")),
      `missing locale pack ${code}`,
    );
    assert.ok(
      fs.existsSync(path.join(root, "i18n", "locales", code, "extras.json")),
      `missing extras pack ${code}`,
    );
  }
  // Bundled resources must include the same 6 locale codes.
  const resources = read("i18n/resources.ts");
  for (const code of ["en", "fr", "es", "ar", "zh", "ff"]) {
    assert.match(resources, new RegExp(`\\b${code}\\s*:`), `resources missing ${code}`);
  }
});

test("locale priority is user choice then preferred_locale then device", () => {
  assert.match(i18n, /explicit user choice/);
  assert.match(i18n, /preferred_locale/);
  const device = read("i18n/deviceLocale.ts");
  assert.match(device, /explicit user choice/);
  assert.match(device, /detectDeviceLocale/);
  assert.match(device, /LOCALE_USER_SET_KEY/);
});

test("language switch cycle covers FR EN ES AR ZH FF", () => {
  // Static contract: every hop in the release gate cycle is a supported code.
  const cycle = ["fr", "en", "es", "ar", "zh", "ff", "fr"];
  for (const code of cycle) {
    assert.match(i18n, new RegExp(`"${code}"`));
  }
  assert.match(i18n, /setLocaleForRoleAndApply/);
  assert.match(i18n, /markLocaleUserSelected/);
});

console.log("languageSwitch.regression.test.ts — PASS");
