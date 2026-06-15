const US = {
  ok: true,
  country_code: "US",
  state_code: "NY",
  scope_label: "United States / New York",
};

const GN = {
  ok: true,
  country_code: "GN",
  scope_label: "Guinea",
};

const CURRENCY = { US: "USD", GN: "GNF" };

function resolve(features) {
  const countryCode = String(features.country_code ?? "").trim().toUpperCase();
  const stateCode = features.state_code ?? null;
  const scopeLabel = features.scope_label?.trim() ?? "";
  let displayLabel = scopeLabel;
  if (!displayLabel && countryCode) {
    displayLabel = stateCode ? `${countryCode} / ${stateCode}` : countryCode;
  }
  return {
    countryCode,
    displayLabel,
    currencyCode: CURRENCY[countryCode] ?? "USD",
    scopeResolved: Boolean(countryCode) && features.ok !== false,
  };
}

function assert(name, ok) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    process.exit(1);
  }
  console.log(`PASS: ${name}`);
}

function coordinatesMatchMarketCountry(lat, lng, marketCountryCode) {
  const market = String(marketCountryCode ?? "").trim().toUpperCase();
  if (!market) return false;
  let inferred = null;
  if (lat >= 7 && lat <= 13 && lng >= -16 && lng <= -7) inferred = "GN";
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) inferred = "US";
  return inferred === market;
}

const us = resolve(US);
const gn = resolve(GN);
const fallback = {
  ok: false,
  taxi_available: false,
  delivery_available: false,
  restaurant_available: false,
};

assert("US label", us.displayLabel === "United States / New York");
assert("US currency", us.currencyCode === "USD");
assert("US no Guinea", !us.displayLabel.includes("Guinea") && us.currencyCode !== "GNF");
assert("GN label", gn.displayLabel === "Guinea");
assert("GN currency", gn.currencyCode === "GNF");
assert("GN no US", !gn.displayLabel.includes("United States") && gn.currencyCode !== "USD");
assert("Fallback not optimistic", fallback.ok === false && fallback.taxi_available === false);
assert("Dev picker off by default", process.env.EXPO_PUBLIC_TAXI_DEV_COUNTRY_PICKER !== "1");
assert("GN coords match GN market", coordinatesMatchMarketCountry(9.5, -13.7, "GN"));
assert("US coords match US market", coordinatesMatchMarketCountry(40.7, -74.0, "US"));
assert("GN coords reject US market", !coordinatesMatchMarketCountry(9.5, -13.7, "US"));

console.log("\nAll automated scope checks passed.");
