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
  { file: "common", key: "common.a11y.close" },
  { file: "common", key: "common.a11y.retry" },
  { file: "common", key: "common.a11y.back" },
  { file: "common", key: "restaurant.orders.accept" },
  { file: "common", key: "restaurant.orders.prepared" },
  { file: "common", key: "restaurant.orders.ready" },
  { file: "common", key: "restaurant.automation.title" },
  { file: "extras", key: "taxi.home.moreOptions" },
  { file: "extras", key: "taxi.home.wallet" },
  { file: "extras", key: "payment.stripe.paymentCanceled" },
  { file: "extras", key: "payment.stripe.applePayUnavailableBody" },
  { file: "extras", key: "clientRestaurantMenu.addresses.pickupLabel" },
  { file: "extras", key: "driver.vehicles.title" },
  { file: "extras", key: "driver.services.title" },
  { file: "extras", key: "driver.identity.screenTitle" },
  { file: "extras", key: "driver.map.preparingNavigation" },
  { file: "extras", key: "taxi.home.comfort" },
  { file: "extras", key: "taxi.home.useMyGps" },
  { file: "extras", key: "taxi.home.optionalPreferences" },
  { file: "extras", key: "client.profile.openSettings" },
  { file: "extras", key: "client.profile.smsConsent" },
  { file: "extras", key: "client.profile.missingFields.phone_verified" },
  { file: "extras", key: "client.restaurants.cuisineAll" },
  { file: "extras", key: "client.home.tabs.home" },
  { file: "extras", key: "restaurant.earnings.stripe.bankKicker" },
  { file: "extras", key: "restaurant.connect.cta.ready_for_payouts.title" },
  { file: "extras", key: "restaurant.wallet.recentTransactions" },
  { file: "extras", key: "deliveryRequest.type.title" },
  { file: "extras", key: "payments.stripeConnect.status.ready_for_payouts" },
  { file: "common", key: "client.home.tabs.orders" },
  { file: "common", key: "client.delivery.tabs.track" },
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

// Cross-locale: critical chrome must not remain English when FR/ES/AR/ZH/FF selected.
for (const lang of ["fr", "es", "ar", "zh", "ff"] as const) {
  const back = String(get(load(lang, "common"), "common.backShort") ?? "");
  assert.notEqual(back, "BACK", `${lang} backShort must not stay BACK`);
  const more = String(get(load(lang, "extras"), "taxi.home.moreOptions") ?? "");
  assert.notEqual(more, "More options", `${lang} moreOptions must be translated`);
  const wallet = String(get(load(lang, "extras"), "taxi.home.wallet") ?? "");
  assert.notEqual(wallet, "Wallet", `${lang} taxi.home.wallet must be translated`);
  if (lang === "ff") {
    assert.notEqual(
      wallet,
      "Portefeuille",
      "ff taxi.home.wallet must be Fulfulde, not French",
    );
    assert.equal(wallet, "Kaalis");
  }
  if (lang === "en") continue;
  const forgot = String(get(load(lang, "common"), "client.auth.forgotPassword") ?? "");
  assert.notEqual(forgot, "Forgot password?", `${lang} forgotPassword must be translated`);
  assert.notEqual(
    String(get(load(lang, "extras"), "taxi.home.comfort") ?? ""),
    "Comfort",
    `${lang} taxi.home.comfort must be translated`,
  );
  assert.notEqual(
    String(get(load(lang, "extras"), "client.profile.openSettings") ?? ""),
    "Settings",
    `${lang} client.profile.openSettings must be translated`,
  );
  assert.notEqual(
    String(get(load(lang, "extras"), "restaurant.earnings.stripe.bankKicker") ?? ""),
    "Bank payouts",
    `${lang} bankKicker must be translated`,
  );
  assert.notEqual(
    String(get(load(lang, "extras"), "client.restaurants.cuisine.african") ?? ""),
    "African",
    `${lang} cuisine african must be translated`,
  );
  assert.notEqual(
    String(get(load(lang, "extras"), "client.restaurants.cuisine.west_african_food") ?? ""),
    "West African Food",
    `${lang} cuisine west_african_food must be translated`,
  );
  assert.notEqual(
    String(get(load(lang, "extras"), "restaurant.connect.cta.ready_for_payouts.action") ?? ""),
    "Manage Payouts",
    `${lang} Stripe manage payouts CTA must be translated`,
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
