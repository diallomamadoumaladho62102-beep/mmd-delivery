import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeNearbyDrivers, sanitizeNearbyEta } from "./nearbyDriversPayload";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const hook = read("hooks/useNearbyActiveDrivers.ts");
const section = read("components/taxi/NearbyDriversSection.tsx");
const home = read("screens/taxi/TaxiHomeScreen.tsx");
const trackingMap = read("components/tracking/LiveTripMap.tsx");
const client = read("lib/taxiClientApi.ts");

assert.match(hook, /AppState\.addEventListener/);
assert.match(hook, /SIGNED_OUT/);
assert.match(hook, /clearInterval\(timer\)/);
assert.match(hook, /appStateSubscription\.remove\(\)/);
assert.match(hook, /45_000/);
assert.match(hook, /\[category, enabled, pickupLat, pickupLng\]/);
assert.doesNotMatch(hook, /driver_locations|supabase\.channel|setInterval\(\s*\(\)\s*=>[\s\S]{0,80}1000/);
assert.match(hook, /EMPTY_NEARBY_SNAPSHOT/);

assert.match(section, /id="nearby-pickup"/);
assert.match(section, /id="nearby-dropoff"/);
assert.match(section, /nearby-driver-/);
assert.match(section, /MMD_TAXI_GREEN/);
assert.match(section, /MMD_GOLD/);
assert.doesNotMatch(section, /MmdDriverLocationMarker|live-driver/);
assert.doesNotMatch(section, /language ===|locale ===/);
assert.doesNotMatch(section, /No drivers available|Drivers nearby|Approx\. pickup/);
assert.match(section, /taxi\.home\.nearbyTitle/);
assert.match(section, /taxi\.home\.nearbyEmpty/);
assert.match(section, /taxi\.home\.nearbyMinutes/);
assert.match(section, /rowDirection\(\)/);
assert.match(section, /textAlignStart\(\)/);

assert.match(trackingMap, /id="live-driver|id="live-driver-aurora"/);
assert.match(home, /NearbyDriversSection/);
assert.match(home, /quoteTaxiRide/);
assert.doesNotMatch(home, /fetchNearbyActiveDrivers/);
const quoteStart = home.indexOf("function handleQuote");
const quoteEnd = home.indexOf("return (", quoteStart);
assert.equal(home.slice(quoteStart, quoteEnd).includes("NearbyDriversSection"), false);

assert.match(client, /\/api\/taxi\/nearby-drivers/);
assert.doesNotMatch(client, /pickup_lat[\s\S]{0,200}createTaxi|PaymentIntent/);

const keys = [
  "nearbyTitle",
  "nearbyEtaLabel",
  "nearbyMinutes",
  "nearbyUpdating",
  "nearbyEtaUnavailable",
  "nearbyEmpty",
  "nearbyLoading",
  "nearbyMapLabel",
  "nearbyMarker",
  "nearbyPickupMarker",
  "nearbyDropoffMarker",
  "nearbyNeedPickup",
  "nearbyError",
];
const locales = ["en", "fr", "es", "ar", "zh", "ff"];
const catalogs = Object.fromEntries(
  locales.map((lang) => [
    lang,
    JSON.parse(read(`i18n/locales/${lang}/extras.json`)) as {
      taxi: { home: Record<string, string> };
    },
  ]),
);
const english = catalogs.en.taxi.home;
for (const lang of locales) {
  for (const key of keys) {
    const value = catalogs[lang].taxi.home[key];
    assert.equal(typeof value, "string", `${lang}.${key}`);
    assert.ok(value.trim().length > 0, `${lang}.${key} empty`);
  }
}
for (const lang of ["fr", "es", "ar", "zh", "ff"]) {
  for (const key of keys) {
    assert.notEqual(catalogs[lang].taxi.home[key], english[key], `${lang}.${key} still English`);
  }
}
assert.match(catalogs.ar.taxi.home.nearbyEmpty, /[\u0600-\u06FF]/);
assert.match(catalogs.zh.taxi.home.nearbyEmpty, /[\u4E00-\u9FFF]/);
assert.notEqual(catalogs.ff.taxi.home.nearbyEmpty, catalogs.fr.taxi.home.nearbyEmpty);
assert.equal(catalogs.ff.taxi.home.nearbyTitle.includes("Chauffeur"), false);

const leaked = sanitizeNearbyDrivers([
  {
    marker_id: "abc123",
    latitude: 40.1,
    longitude: -73.2,
    driver_id: "11111111-1111-4111-8111-111111111111",
    phone: "555",
    email: "a@b.c",
  },
]);
assert.deepEqual(leaked, []);
assert.deepEqual(
  sanitizeNearbyDrivers([{ marker_id: "abc123", latitude: 40.1, longitude: -73.2 }]),
  [{ markerId: "abc123", latitude: 40.1, longitude: -73.2 }],
);
assert.deepEqual(sanitizeNearbyEta({ available: false, minutes: 4 }), {
  available: false,
  minutes: null,
});
assert.deepEqual(sanitizeNearbyEta({ available: true, minutes: 9, driver_id: "x" }), {
  available: true,
  minutes: 9,
});

console.log("nearbyDrivers.regression.test.ts OK");
