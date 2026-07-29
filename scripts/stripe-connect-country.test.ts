/**
 * Unit tests for supabase/functions/_shared/stripeConnectCountry.ts
 * Run: npx tsx scripts/stripe-connect-country.test.ts
 */
import {
  isUsStateValue,
  normalizeAllowlistedConnectCountry,
  resolveStripeConnectCountry,
  US_STATE_OR_TERRITORY_CODES,
} from "../supabase/functions/_shared/stripeConnectCountry";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(normalizeAllowlistedConnectCountry("SN") === "SN", "SN allowlisted");
assert(normalizeAllowlistedConnectCountry("Senegal") === "SN", "Senegal → SN");
assert(normalizeAllowlistedConnectCountry("CA") === "CA", "CA body = Canada");
assert(normalizeAllowlistedConnectCountry("NY") === null, "NY not allowlisted");
assert(normalizeAllowlistedConnectCountry("XX") === null, "XX rejected");

assert(isUsStateValue("NY") === true, "NY is US state");
assert(isUsStateValue("OH") === true, "OH is US state");
assert(isUsStateValue("CA") === true, "CA state is California");
assert(isUsStateValue("Ohio") === true, "Ohio name is US state");
assert(isUsStateValue("SN") === false, "SN is not US state");
assert(US_STATE_OR_TERRITORY_CODES.has("CA"), "CA in US set");

assert(
  resolveStripeConnectCountry({ bodyCountryCode: "CA", state: "NY" }) === "CA",
  "body CA wins over state NY",
);
assert(
  resolveStripeConnectCountry({ bodyCountryCode: "ny", city: "Dakar" }) === "SN",
  "invalid body NY falls through to city Dakar → SN",
);
assert(
  resolveStripeConnectCountry({ city: "Conakry" }) === "GN",
  "Conakry → GN",
);
assert(
  resolveStripeConnectCountry({ city: "Abidjan" }) === "CI",
  "Abidjan → CI",
);
assert(
  resolveStripeConnectCountry({ state: "NY" }) === "US",
  "state NY → US (never Stripe country NY)",
);
assert(
  resolveStripeConnectCountry({ state: "OH" }) === "US",
  "state OH → US",
);
assert(
  resolveStripeConnectCountry({ state: "CA" }) === "US",
  "state CA → US not Canada",
);
assert(
  resolveStripeConnectCountry({ state: "SN" }) === "SN",
  "state SN (not US) → SN",
);
assert(
  resolveStripeConnectCountry({ profileCountryCode: "GN" }) === "GN",
  "profile country_code GN",
);
assert(
  resolveStripeConnectCountry({}) === "US",
  "default US",
);
assert(
  resolveStripeConnectCountry({ country: "France" }) === "FR",
  "country France → FR",
);

console.log("stripe-connect-country.test.ts: ok");
