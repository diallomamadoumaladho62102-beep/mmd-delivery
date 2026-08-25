import assert from "node:assert/strict";
import { marketplaceOrderStatusKey, prepMinutesSuffix, pushText, taxiComplianceCopy } from "./pushCopy";
import { htmlLangForLocale, normalizeAppLocale } from "./userLocale";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("normalizeAppLocale maps variants", () => {
  assert.equal(normalizeAppLocale("fr-FR"), "fr");
  assert.equal(normalizeAppLocale("ar-EG"), "ar");
  assert.equal(normalizeAppLocale("zh-Hans"), "zh");
  assert.equal(normalizeAppLocale("ff-SN"), "ff");
  assert.equal(normalizeAppLocale("de"), "en");
});

test("push catalog has 6 locales and non-EN copy differs", () => {
  const keys = [
    "order_confirmed",
    "taxi_offer",
    "new_order",
    "new_marketplace_order",
    "new_message",
    "identity_verified",
    "plus_created",
  ] as const;
  for (const key of keys) {
    const en = pushText(key, "en");
    for (const locale of ["fr", "es", "ar", "zh", "ff"] as const) {
      const copy = pushText(key, locale);
      assert.ok(copy.title.trim().length > 1, `${key} ${locale} title`);
      assert.notEqual(copy.title, en.title, `${key} ${locale} must not stay English`);
    }
  }
});

test("interpolations fill minutes and payout", () => {
  const eta = pushText("taxi_en_route", "fr", { minutes: 6 });
  assert.match(eta.body, /6/);
  const payout = pushText("taxi_offer_payout", "es", { payout: "12.50" });
  assert.match(payout.body, /12\.50/);
});

test("new dispatch and compliance keys are localized", () => {
  assert.notEqual(pushText("delivery_offer", "en").title, pushText("delivery_offer", "ar").title);
  assert.match(pushText("delivery_offer_payout", "fr", { payout: "9.00" }).body, /9\.00/);
  assert.notEqual(pushText("driver_offer", "en").title, pushText("driver_offer", "zh").title);
  assert.match(
    taxiComplianceCopy("insurance_expired", "driver", "fr").body,
    /assurance/i,
  );
  assert.match(
    taxiComplianceCopy("driver_profile_suspended", "client", "en").body,
    /compliance/i,
  );
});

test("marketplace and prep helpers", () => {
  assert.equal(marketplaceOrderStatusKey("refused"), "marketplace_refused");
  assert.equal(marketplaceOrderStatusKey("unknown"), "marketplace_update");
  assert.equal(prepMinutesSuffix("en", 0), "");
  assert.match(prepMinutesSuffix("fr", 12), /12/);
  assert.equal(htmlLangForLocale("ar"), "ar");
});

console.log("pushCopy.test.ts: all passed");
