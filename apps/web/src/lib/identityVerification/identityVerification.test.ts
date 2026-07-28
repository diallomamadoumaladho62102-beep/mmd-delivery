import assert from "node:assert/strict";
import { isIdentitySubjectType } from "./webhook";
import { mapStripeStatusToMmd } from "./service";

assert.equal(isIdentitySubjectType("driver"), true);
assert.equal(isIdentitySubjectType("seller"), true);
assert.equal(isIdentitySubjectType("nope"), false);

assert.equal(mapStripeStatusToMmd("verified"), "verified");
assert.equal(mapStripeStatusToMmd("requires_input"), "requires_input");
assert.equal(mapStripeStatusToMmd("processing"), "processing");
assert.equal(mapStripeStatusToMmd("canceled"), "canceled");
assert.equal(mapStripeStatusToMmd("redacted"), "redacted");
assert.equal(mapStripeStatusToMmd("unknown"), "pending");

console.log("identityVerification basic tests passed");
