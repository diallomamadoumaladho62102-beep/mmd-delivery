import assert from "node:assert/strict";
import { isIdentitySubjectType } from "./webhook";

assert.equal(isIdentitySubjectType("driver"), true);
assert.equal(isIdentitySubjectType("seller"), true);
assert.equal(isIdentitySubjectType("nope"), false);

function mapStripeStatusToMmd(status: string): string {
  switch (String(status ?? "").toLowerCase()) {
    case "verified":
      return "verified";
    case "processing":
      return "processing";
    case "requires_input":
      return "requires_input";
    case "canceled":
      return "canceled";
    case "redacted":
      return "redacted";
    default:
      return "pending";
  }
}

assert.equal(mapStripeStatusToMmd("verified"), "verified");
assert.equal(mapStripeStatusToMmd("requires_input"), "requires_input");
assert.equal(mapStripeStatusToMmd("processing"), "processing");

console.log("identityVerification basic tests passed");
