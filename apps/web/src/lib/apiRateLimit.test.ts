import assert from "node:assert/strict";
import {
  checkRateLimit,
  classifyApiPath,
  limitsForTier,
} from "./apiRateLimit";

assert.equal(classifyApiPath("/api/stripe/webhook"), "webhook");
assert.equal(classifyApiPath("/api/payments/webhook/paydunya"), "webhook");
assert.equal(classifyApiPath("/api/stripe/client/create-checkout-session"), "money");
assert.equal(classifyApiPath("/api/taxi/rides/quote"), "money");
assert.equal(classifyApiPath("/api/mapbox/geocode"), "location");
assert.equal(classifyApiPath("/api/cron/retry-order-dispatch"), "exempt");
assert.equal(limitsForTier("exempt"), null);
assert.ok((limitsForTier("money")?.limit ?? 0) > 0);

const key = `test-${Date.now()}`;
for (let i = 0; i < 3; i += 1) {
  const r = checkRateLimit({ namespace: "unit", key, limit: 3, windowMs: 60_000 });
  assert.equal(r.limited, false);
}
const blocked = checkRateLimit({ namespace: "unit", key, limit: 3, windowMs: 60_000 });
assert.equal(blocked.limited, true);
assert.ok(blocked.retryAfterSec >= 1);

console.log("apiRateLimit.test.ts OK");
