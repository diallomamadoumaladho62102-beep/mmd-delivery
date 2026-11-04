import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  asMarketCountry,
  isPlausibleGuineaPhone,
  marketCurrency,
  marketPhonePrefix,
  marketRequiresPostalCode,
  normalizeGuineaPhone,
} from "./selectedMarket";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

assert.equal(asMarketCountry("gn"), "GN");
assert.equal(asMarketCountry("US"), "US");
assert.equal(asMarketCountry("FR"), null);
assert.equal(asMarketCountry("+224"), null);

assert.equal(marketPhonePrefix("GN"), "+224");
assert.equal(marketCurrency("GN"), "GNF");
assert.equal(marketRequiresPostalCode("GN"), false);
assert.equal(marketPhonePrefix("US"), "+1");
assert.equal(marketCurrency("US"), "USD");
assert.equal(marketRequiresPostalCode("US"), true);

assert.equal(normalizeGuineaPhone("620800841"), "+224620800841");
assert.equal(normalizeGuineaPhone("+224 620 80 08 41"), "+224620800841");
assert.equal(isPlausibleGuineaPhone(normalizeGuineaPhone("620800841")), true);
assert.equal(isPlausibleGuineaPhone("+224"), false);

const app = read("../App.tsx");
assert.match(app, /resolveStartupMarket/);
assert.match(app, /CountryWelcome/);
assert.match(app, /RoleSelect/);

const welcome = read("screens/CountryWelcomeScreen.tsx");
assert.match(welcome, /guineaMarket\.welcomeTitle/);
assert.match(welcome, /marketPhonePrefix/);
assert.match(welcome, /marketCurrency/);
assert.doesNotMatch(welcome, /Bienvenue sur MMD/);
assert.match(welcome, /disabled=\{!selected \|\| saving\}/);
assert.match(welcome, /navigation.replace\("RoleSelect"\)/);

const tabs = read("components/guinea/GuineaServiceTabs.tsx");
assert.match(tabs, /guineaMarket\.tabsTaxi/);
assert.match(tabs, /guineaMarket\.tabsRestaurants/);
assert.match(tabs, /guineaMarket\.tabsParcels/);
assert.match(tabs, /GuineaTaxiRequest|TaxiHome/);

const hub = read("components/guinea/GuineaTaxiHub.tsx");
assert.match(hub, /guineaMarket\.whereTo/);
assert.match(hub, /guineaMarket\.seePrice/);
assert.match(hub, /GuineaTaxiRequest/);

const roles = read("screens/RoleSelectScreen.tsx");
assert.match(roles, /Browse Marketplace/);
assert.doesNotMatch(roles, /CountryWelcome/);

const driver = read("screens/DriverAuthScreen.tsx");
assert.match(driver, /9297408722 or \+19297408722/);
assert.match(driver, /marketCountry === "GN"/);
assert.match(driver, /isPlausibleGuineaPhone/);

const navigator = read("navigation/AppNavigator.tsx");
assert.match(navigator, /name="RoleSelect"/);
assert.match(navigator, /name="CountryWelcome"/);
assert.match(navigator, /cur === "CountryWelcome"/);

console.log("selectedMarket.test.ts — PASS");
