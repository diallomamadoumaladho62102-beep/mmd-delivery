import assert from "node:assert/strict";
import {
  checkDistributedRateLimit,
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

// Proxy must still classify the same money/webhook paths used by apps/web/proxy.ts
assert.equal(classifyApiPath("/api/stripe/client/create-taxi-checkout-session"), "money");
assert.equal(classifyApiPath("/api/payments/webhook/cinetpay"), "webhook");
assert.equal(classifyApiPath("/api/sms/opt-in"), "auth_sensitive");
assert.equal(classifyApiPath("/api/auth/phone/start"), "auth_sensitive");
assert.equal(classifyApiPath("/api/wallet/driver-cashout"), "money");
assert.equal(classifyApiPath("/api/ai/chat"), "auth_sensitive");
assert.equal(classifyApiPath("/api/ai/transcribe"), "auth_sensitive");
assert.equal(classifyApiPath("/api/site/analytics"), "auth_sensitive");
assert.equal(classifyApiPath("/api/admin/staff-login-check"), "auth_sensitive");
assert.equal(classifyApiPath("/api/identity/sessions"), "auth_sensitive");

const key = `test-${Date.now()}`;
for (let i = 0; i < 3; i += 1) {
  const r = checkRateLimit({ namespace: "unit", key, limit: 3, windowMs: 60_000 });
  assert.equal(r.limited, false);
}
const blocked = checkRateLimit({ namespace: "unit", key, limit: 3, windowMs: 60_000 });
assert.equal(blocked.limited, true);
assert.ok(blocked.retryAfterSec >= 1);

async function main() {
  const distKey = `dist-${Date.now()}`;
  for (let i = 0; i < 2; i += 1) {
    const r = await checkDistributedRateLimit({
      namespace: "unit-dist",
      key: distKey,
      limit: 2,
      windowMs: 60_000,
    });
    assert.equal(r.limited, false);
  }
  const distBlocked = await checkDistributedRateLimit({
    namespace: "unit-dist",
    key: distKey,
    limit: 2,
    windowMs: 60_000,
  });
  assert.equal(distBlocked.limited, true);
  console.log("apiRateLimit.test.ts OK");
}

void main();
