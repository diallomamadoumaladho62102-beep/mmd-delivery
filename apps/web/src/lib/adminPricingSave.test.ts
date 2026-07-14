import assert from "node:assert/strict";
import { buildPricingPayload } from "./adminPricingSave";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function expectThrows(fn: () => void, includes: string) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "expected throw" || !message.includes(includes)) {
      throw new Error(`Expected error containing "${includes}", got "${message}"`);
    }
  }
}

function baseForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("id", "11111111-1111-4111-8111-111111111111");
  fd.set("active", "true");
  fd.set("currency", "USD");
  fd.set("restaurant_pct", "85");
  fd.set("platform_pct", "15");
  fd.set("delivery_platform_pct", "20");
  fd.set("delivery_driver_pct", "80");
  fd.set("delivery_fee_base", "2.5");
  fd.set("delivery_fee_per_mile", "0.9");
  fd.set("delivery_fee_per_minute", "0.15");
  fd.set("minimum_order_amount", "0");
  fd.set("promo_enabled", "false");
  fd.set("region", "global");
  fd.set("tax_enabled", "false");
  fd.set("tax_pct", "0");
  fd.set("service_fee_enabled", "false");
  fd.set("service_fee_pct", "0");
  fd.set("service_fee_fixed", "0");
  for (const [key, value] of Object.entries(overrides)) {
    fd.set(key, value);
  }
  return fd;
}

test("admin accepts 70 + 30 delivery split", () => {
  const { payload } = buildPricingPayload(
    baseForm({ delivery_driver_pct: "70", delivery_platform_pct: "30" })
  );
  assert.equal(payload.delivery_driver_pct, 70);
  assert.equal(payload.delivery_platform_pct, 30);
});

test("admin accepts 80 + 20 delivery split", () => {
  const { payload } = buildPricingPayload(baseForm());
  assert.equal(payload.delivery_driver_pct, 80);
  assert.equal(payload.delivery_platform_pct, 20);
});

test("admin refuses 80 + 25 delivery split", () => {
  expectThrows(
    () =>
      buildPricingPayload(
        baseForm({ delivery_driver_pct: "80", delivery_platform_pct: "25" })
      ),
    "≤ 100"
  );
});

test("admin converts 0–1 fraction inputs to 0–100", () => {
  const { payload } = buildPricingPayload(
    baseForm({ delivery_driver_pct: "0.8", delivery_platform_pct: "0.2" })
  );
  assert.equal(payload.delivery_driver_pct, 80);
  assert.equal(payload.delivery_platform_pct, 20);
});

test("admin does not mix restaurant vendor % into delivery split requirement", () => {
  // restaurant 85 + platform 15 is valid vendor split; delivery must still be exactly 100.
  const { payload } = buildPricingPayload(
    baseForm({
      restaurant_pct: "85",
      platform_pct: "15",
      delivery_driver_pct: "75",
      delivery_platform_pct: "25",
    })
  );
  assert.equal(payload.restaurant_pct, 85);
  assert.equal(payload.platform_pct, 15);
  assert.equal(payload.delivery_driver_pct + payload.delivery_platform_pct, 100);
});

test("admin refuses vendor restaurant+platform > 100", () => {
  expectThrows(
    () =>
      buildPricingPayload(
        baseForm({ restaurant_pct: "90", platform_pct: "20" })
      ),
    "Restaurant % + Platform %"
  );
});

console.log("adminPricingSave.test.ts OK");
