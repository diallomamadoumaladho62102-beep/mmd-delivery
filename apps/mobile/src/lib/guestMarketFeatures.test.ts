import assert from "node:assert/strict";

import {
  resolveSignedOutPlatformFeatures,
  signedOutMarketCountry,
} from "./guestMarketFeatures";

const guinea = resolveSignedOutPlatformFeatures("GN");
assert.equal(guinea.error, "not_authenticated");
assert.equal(guinea.country_code, "GN");
assert.equal(guinea.scope_source, "selected_market");
assert.equal(guinea.ok, false);
assert.equal(guinea.checkout_enabled, false);
assert.equal(guinea.payout_enabled, false);
assert.equal(guinea.seller_available, false);
assert.equal(guinea.marketplace_available, false);
assert.equal(signedOutMarketCountry(guinea), "GN");

const us = resolveSignedOutPlatformFeatures("us");
assert.equal(us.country_code, "US");
assert.equal(signedOutMarketCountry(us), "US");

const none = resolveSignedOutPlatformFeatures(null);
assert.equal(none.error, "not_authenticated");
assert.equal(none.country_code, undefined);
assert.equal(signedOutMarketCountry(none), null);

const other = resolveSignedOutPlatformFeatures("FR");
assert.equal(other.country_code, undefined);
assert.notEqual(other.error, "scope_unresolved");

console.log("guestMarketFeatures.test.ts OK");
