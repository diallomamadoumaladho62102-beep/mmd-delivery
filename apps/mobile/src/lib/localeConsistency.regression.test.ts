/**
 * Guards critical UI strings that caused FR/EN mixes on TestFlight build 80.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const locales = path.join(root, "i18n", "locales");

function load(lang: string, file: "common" | "extras") {
  return JSON.parse(
    fs.readFileSync(path.join(locales, lang, `${file}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function get(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

const REQUIRED: Array<{ file: "common" | "extras"; key: string }> = [
  { file: "common", key: "common.backShort" },
  { file: "common", key: "client.auth.showPassword" },
  { file: "common", key: "client.auth.hidePassword" },
  { file: "common", key: "client.auth.forgotPassword" },
  { file: "common", key: "restaurant.signOut.confirm" },
  { file: "common", key: "restaurant.home.status.offlineShort" },
  { file: "common", key: "restaurant.home.nav.payouts" },
  { file: "common", key: "restaurant.home.map.offlineHint" },
  { file: "extras", key: "taxi.home.moreOptions" },
  { file: "extras", key: "payment.stripe.paymentCanceled" },
  { file: "extras", key: "payment.stripe.applePayUnavailableBody" },
  { file: "extras", key: "clientRestaurantMenu.addresses.pickupLabel" },
];

for (const lang of ["en", "fr", "es", "ar", "zh", "ff"]) {
  const common = load(lang, "common");
  const extras = load(lang, "extras");
  for (const req of REQUIRED) {
    const bag = req.file === "common" ? common : extras;
    const value = get(bag, req.key);
    assert.equal(
      typeof value,
      "string",
      `${lang}.${req.key} must be a non-empty string`,
    );
    assert.ok(String(value).trim().length > 0, `${lang}.${req.key} empty`);
  }
  assert.notEqual(
    get(load("fr", "common"), "common.backShort"),
    "BACK",
    "French backShort must not stay English BACK",
  );
  assert.notEqual(
    get(load("fr", "extras"), "taxi.home.moreOptions"),
    "More options",
    "French moreOptions must be translated",
  );
  assert.notEqual(
    get(load("fr", "common"), "restaurant.signOut.confirm"),
    "Log out",
    "French restaurant signOut must be translated",
  );
}

const header = fs.readFileSync(
  path.join(root, "components", "navigation", "ScreenHeader.tsx"),
  "utf8",
);
assert.match(header, /common\.backShort/);
assert.match(header, /visibleBackLabel/);

const auth = fs.readFileSync(
  path.join(root, "screens", "ClientAuthScreen.tsx"),
  "utf8",
);
assert.doesNotMatch(auth, /\{showPassword \? "Cacher" : "Voir"\}/);
assert.match(auth, /client\.auth\.showPassword/);
assert.match(auth, /client\.auth\.forgotPassword/);

console.log("localeConsistency.regression.test.ts OK");
