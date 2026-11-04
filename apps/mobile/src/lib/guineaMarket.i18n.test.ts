/**
 * Guinea market copy must live in the existing 6-locale extras catalog.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(root, "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"] as const;

function loadExtras(lang: string) {
  return JSON.parse(
    fs.readFileSync(path.join(localesDir, lang, "extras.json"), "utf8"),
  ) as Record<string, unknown>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.ok(value && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return leafKeys(value as Record<string, unknown>, next);
    }
    return [next];
  });
}

const extras = Object.fromEntries(LANGS.map((lang) => [lang, loadExtras(lang)]));
const guinea = asRecord(extras.en.guineaMarket, "en.guineaMarket");
const taxi = asRecord(extras.en.taxiGuinea, "en.taxiGuinea");
const picker = asRecord(extras.en.locationPicker, "en.locationPicker");
const guineaKeys = Object.keys(guinea).sort();
const taxiKeys = Object.keys(taxi).sort();

assert.ok(guineaKeys.length >= 40, "en.guineaMarket must cover the Guinea UI surface");
assert.ok(taxiKeys.includes("searchingDrivers"));
assert.ok(typeof picker.hintPinConfirmLocal === "string");
assert.ok(typeof picker.useGpsCurrent === "string");
assert.ok(typeof picker.communeTown === "string");

for (const lang of LANGS) {
  const bag = asRecord(extras[lang].guineaMarket, `${lang}.guineaMarket`);
  assert.deepEqual(
    Object.keys(bag).sort(),
    guineaKeys,
    `${lang}.guineaMarket keys must match English`,
  );
  for (const key of guineaKeys) {
    const value = bag[key];
    assert.equal(typeof value, "string", `${lang}.guineaMarket.${key} must be a string`);
    assert.ok(String(value).trim().length > 0, `${lang}.guineaMarket.${key} empty`);
  }
  const taxiBag = asRecord(extras[lang].taxiGuinea, `${lang}.taxiGuinea`);
  assert.deepEqual(
    Object.keys(taxiBag).sort(),
    taxiKeys,
    `${lang}.taxiGuinea keys must match English`,
  );
}

assert.equal(extras.fr.guineaMarket && (extras.fr.guineaMarket as Record<string, string>).welcomeTitle, "Bienvenue sur MMD");
assert.equal((extras.en.guineaMarket as Record<string, string>).welcomeTitle, "Welcome to MMD");
assert.notEqual(
  (extras.ff.guineaMarket as Record<string, string>).welcomeTitle,
  (extras.fr.guineaMarket as Record<string, string>).welcomeTitle,
  "Fulfulde welcomeTitle must not copy French",
);
assert.notEqual(
  (extras.es.guineaMarket as Record<string, string>).authContinue,
  (extras.en.guineaMarket as Record<string, string>).authContinue,
);

const files = [
  "screens/CountryWelcomeScreen.tsx",
  "components/guinea/GuineaServiceTabs.tsx",
  "components/guinea/GuineaTaxiHub.tsx",
  "screens/taxi/GuineaTaxiRequestScreen.tsx",
  "screens/ClientAuthScreen.tsx",
  "screens/DriverAuthScreen.tsx",
  "screens/DeliveryRequestScreen.tsx",
  "components/location/MMDLocationPicker.tsx",
  "screens/ClientRestaurantListScreen.tsx",
  "screens/ClientRestaurantMenuScreen.tsx",
];

const forbidden = [
  /Bienvenue sur MMD/,
  /Où allez-vous/,
  /Voir le prix/,
  /Choisir sur la carte/,
  /Confirmer la livraison/,
  /Confirmer la course/,
  /Téléphone d’urgence \(facultatif\)/,
  /Quartier, marché ou repère/,
  /Ma position actuelle/,
];

for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(src, /useTranslation/, `${rel} must use the existing i18n hook`);
  for (const pattern of forbidden) {
    assert.doesNotMatch(src, pattern, `${rel} still has hardcoded ${pattern}`);
  }
}

const welcome = fs.readFileSync(path.join(root, "screens/CountryWelcomeScreen.tsx"), "utf8");
assert.match(welcome, /guineaMarket\.welcomeTitle/);
assert.match(welcome, /marketPhonePrefix\("GN"\)/);
assert.match(welcome, /marketCurrency\("GN"\)/);
assert.match(welcome, /RoleSelect/);

const formatters = fs.readFileSync(path.join(root, "i18n/formatters.ts"), "utf8");
assert.match(formatters, /export function priceCentsToMajor/);
assert.match(formatters, /export function majorToPriceCents/);
assert.match(formatters, /code === "GNF" \? minor : minor \/ 100/);
assert.match(formatters, /code === "GNF" \? Math\.round\(major\) : Math\.round\(major \* 100\)/);
assert.match(formatters, /return `\$\{formatted\} GNF`/);

const setup = fs.readFileSync(path.join(root, "screens/restaurant/RestaurantSetupScreen.tsx"), "utf8");
assert.match(setup, /marketRequiresPostalCode\(selectedMarket\)/);
assert.match(setup, /, NY \$\{restaurantPostalCode\}/);
assert.match(setup, /guineaMarket\.restaurantSetupRequired/);
assert.match(setup, /isPlausibleGuineaPhone\(phoneForSave\)/);

const i18n = fs.readFileSync(path.join(root, "i18n/index.ts"), "utf8");
assert.match(i18n, /ALLOWED_LOCALES = new Set\(\["en", "fr", "es", "ar", "zh", "ff"\]\)/);
assert.match(i18n, /DEFAULT_LOCALE = "en"/);
assert.match(i18n, /fallbackLng: DEFAULT_LOCALE/);

const usedKeys = new Set<string>();
const keyRe =
  /(?:t|tr)\(\s*["'](guineaMarket\.[A-Za-z0-9_]+|taxiGuinea\.[A-Za-z0-9_]+|locationPicker\.(?:hintPinConfirmLocal|useGpsCurrent|communeTown|quartierSector|landmarkPlaceholderLocal))["']/g;
for (const rel of files) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  for (const match of src.matchAll(keyRe)) {
    usedKeys.add(match[1]);
  }
}
assert.ok(usedKeys.size > 20, "Guinea screens must reference translation keys");
for (const dotted of usedKeys) {
  for (const lang of LANGS) {
    const parts = dotted.split(".");
    let cur: unknown = extras[lang];
    for (const part of parts) {
      cur = asRecord(cur, `${lang}.${dotted}`)[part];
    }
    assert.equal(
      typeof cur,
      "string",
      `missing ${lang}.${dotted} (used in Guinea UI)`,
    );
  }
}

void leafKeys;
console.log("guineaMarket.i18n.test.ts OK");
