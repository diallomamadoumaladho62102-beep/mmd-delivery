/**
 * Guards the Client food / package / ride checkout i18n mix that blocked Apple.
 * lang=en must not fall back to French; lang=fr must translate the screenshot keys.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
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

function mergeDeep(base: unknown, override: unknown): unknown {
  if (base == null || typeof base !== "object" || Array.isArray(base)) {
    return override ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (override == null || typeof override !== "object" || Array.isArray(override)) {
    return out;
  }
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const bv = out[k];
    if (
      bv &&
      typeof bv === "object" &&
      !Array.isArray(bv) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      out[k] = mergeDeep(bv, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function bundle(lang: string) {
  const common = load(lang, "common");
  const extras = load(lang, "extras");
  const enCommon = load("en", "common");
  const enExtras = load("en", "extras");
  const en = mergeDeep(enCommon, enExtras);
  if (lang === "en") return en;
  return mergeDeep(mergeDeep(en, common), extras);
}

const SCREENSHOT_KEYS = [
  "clientRestaurantMenu.addresses.title",
  "clientRestaurantMenu.addresses.pickupLabel",
  "clientRestaurantMenu.addresses.dropoffLabel",
  "clientRestaurantMenu.addresses.pickupLockedHint",
  "clientRestaurantMenu.addresses.autoEstimateHint",
  "clientRestaurantMenu.leaveAtDoor.title",
  "clientRestaurantMenu.cart.title",
  "clientRestaurantMenu.cart.empty",
  "clientRestaurantMenu.create.confirm",
  "clientRestaurantMenu.header.subtitle",
  "deliveryRequest.header.title",
  "deliveryRequest.fields.dropoffContactName",
  "deliveryRequest.fields.dropoffPhone",
  "deliveryRequest.fields.packageDescription",
  "deliveryRequest.pricing.title",
  "deliveryRequest.pricing.emptyHint",
  "deliveryRequest.actions.calculate",
  "deliveryRequest.actions.payAndConfirm",
  "common.optional",
  "common.backShort",
  "client.home.tabs.home",
  "client.home.tabs.orders",
  "client.delivery.tabs.track",
  "client.profile.titleShort",
] as const;

const FRENCH_UI =
  /[àâäéèêëïîôùûüçœÀÂÄÉÈÊËÏÎÔÙÛÜÇŒ]|\b(adresse|panier|paiement|commande|ajouter|optionnel|livraison|confirmer|retour)\b/i;

const SCREEN_FILES = [
  "screens/ClientRestaurantMenuScreen.tsx",
  "screens/DeliveryRequestScreen.tsx",
  "screens/ClientNewOrderScreen.tsx",
  "screens/_shared/OrderChatBase.tsx",
  "components/navigation/ClientServiceBottomNav.tsx",
  "components/navigation/ScreenHeader.tsx",
];

const en = bundle("en") as Record<string, unknown>;
const fr = bundle("fr") as Record<string, unknown>;

for (const key of SCREENSHOT_KEYS) {
  const enVal = get(en, key);
  const frVal = get(fr, key);
  assert.equal(typeof enVal, "string", `EN missing ${key}`);
  assert.equal(typeof frVal, "string", `FR missing ${key}`);
  assert.ok(String(enVal).trim(), `EN empty ${key}`);
  assert.ok(String(frVal).trim(), `FR empty ${key}`);
}

assert.equal(
  get(en, "clientRestaurantMenu.addresses.pickupLabel"),
  "Pickup address (restaurant / start point)",
);
assert.equal(
  get(fr, "clientRestaurantMenu.addresses.pickupLabel"),
  "Adresse de retrait (restaurant / point de départ)",
);
assert.equal(get(en, "clientRestaurantMenu.cart.title"), "Cart");
assert.equal(get(fr, "clientRestaurantMenu.cart.title"), "Panier");
assert.equal(get(en, "deliveryRequest.actions.payAndConfirm"), "Pay and confirm delivery");
assert.equal(get(fr, "deliveryRequest.actions.payAndConfirm"), "Payer et confirmer la livraison");
assert.equal(get(en, "deliveryRequest.pricing.title"), "Price summary");
assert.equal(get(fr, "deliveryRequest.pricing.title"), "Récapitulatif du prix");
assert.equal(get(en, "common.optional"), "Optional");
assert.equal(get(fr, "common.optional"), "Optionnel");
assert.notEqual(get(fr, "common.backShort"), "BACK");
assert.notEqual(
  get(fr, "clientRestaurantMenu.addresses.title"),
  get(en, "clientRestaurantMenu.addresses.title"),
);

for (const rel of SCREEN_FILES) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const quoted = [
    ...src.matchAll(/(?:t|tr|ts)\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']/g),
  ];
  for (const match of quoted) {
    const fallback = match[2];
    assert.ok(
      !FRENCH_UI.test(fallback),
      `${rel} still uses a French defaultValue for ${match[1]}: ${fallback}`,
    );
  }
}

assert.match(
  fs.readFileSync(path.join(root, "screens/ClientRestaurantMenuScreen.tsx"), "utf8"),
  /clientRestaurantMenu\.addresses\.pickupLabel/,
);
assert.match(
  fs.readFileSync(path.join(root, "screens/DeliveryRequestScreen.tsx"), "utf8"),
  /deliveryRequest\.actions\.payAndConfirm/,
);

console.log("clientCheckoutI18n.regression.test.ts OK");
