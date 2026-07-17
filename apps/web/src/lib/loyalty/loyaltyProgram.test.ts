import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOYALTY_SETTINGS,
  DEFAULT_LOYALTY_TIERS,
  canConvert,
  convertibleBlocks,
  creditCentsForBlocks,
  formatCredit,
  nextTier,
  parseLoyaltySettings,
  resolveConversionBlocks,
  resolveTier,
} from "@/lib/loyalty/loyaltyProgram";

test("resolveTier returns bronze at zero lifetime", () => {
  assert.equal(resolveTier(0).code, "bronze");
});

test("resolveTier climbs tiers at thresholds", () => {
  assert.equal(resolveTier(99).code, "bronze");
  assert.equal(resolveTier(100).code, "silver");
  assert.equal(resolveTier(499).code, "silver");
  assert.equal(resolveTier(500).code, "gold");
  assert.equal(resolveTier(1500).code, "platinum");
  assert.equal(resolveTier(999999).code, "platinum");
});

test("resolveTier clamps negative lifetime to bronze", () => {
  assert.equal(resolveTier(-50).code, "bronze");
});

test("nextTier points to the following tier or null at top", () => {
  assert.equal(nextTier(0)?.code, "silver");
  assert.equal(nextTier(100)?.code, "gold");
  assert.equal(nextTier(1500), null);
});

test("convertibleBlocks floors to whole blocks", () => {
  assert.equal(convertibleBlocks(0, 100), 0);
  assert.equal(convertibleBlocks(99, 100), 0);
  assert.equal(convertibleBlocks(100, 100), 1);
  assert.equal(convertibleBlocks(250, 100), 2);
});

test("convertibleBlocks guards against zero divisor", () => {
  assert.equal(convertibleBlocks(500, 0), 0);
});

test("canConvert requires at least one full block", () => {
  assert.equal(canConvert(99, 100), false);
  assert.equal(canConvert(100, 100), true);
});

test("creditCentsForBlocks multiplies blocks by per-block value", () => {
  assert.equal(creditCentsForBlocks(1, 500), 500);
  assert.equal(creditCentsForBlocks(3, 500), 1500);
  assert.equal(creditCentsForBlocks(0, 500), 0);
});

test("resolveConversionBlocks clamps to affordable and rejects invalid", () => {
  // balance 250 => 2 affordable blocks
  assert.equal(resolveConversionBlocks(1, 250, 100), 1);
  assert.equal(resolveConversionBlocks(2, 250, 100), 2);
  assert.equal(resolveConversionBlocks(5, 250, 100), 2);
  assert.equal(resolveConversionBlocks(0, 250, 100), 0);
  assert.equal(resolveConversionBlocks(-3, 250, 100), 0);
});

test("formatCredit renders cents as major units", () => {
  assert.equal(formatCredit(500), "5.00 USD");
  assert.equal(formatCredit(1234, "EUR"), "12.34 EUR");
  assert.equal(formatCredit(-100), "0.00 USD");
});

test("parseLoyaltySettings falls back to defaults on null", () => {
  const s = parseLoyaltySettings(null);
  assert.deepEqual(s, DEFAULT_LOYALTY_SETTINGS);
});

test("parseLoyaltySettings normalizes snake_case row", () => {
  const s = parseLoyaltySettings({
    enabled: false,
    points_per_delivery: 2,
    points_per_ride: 3,
    conversion_points: 200,
    conversion_credit_cents: 1000,
    credit_validity_months: 6,
    referral_points_client: 15,
    referral_points_driver: 20,
    currency: "CAD",
  });
  assert.equal(s.enabled, false);
  assert.equal(s.pointsPerDelivery, 2);
  assert.equal(s.pointsPerRide, 3);
  assert.equal(s.conversionPoints, 200);
  assert.equal(s.conversionCreditCents, 1000);
  assert.equal(s.creditValidityMonths, 6);
  assert.equal(s.referralPointsClient, 15);
  assert.equal(s.referralPointsDriver, 20);
  assert.equal(s.currency, "CAD");
});

test("parseLoyaltySettings coerces invalid validity to 0 and clamps minimums", () => {
  const s = parseLoyaltySettings({
    credit_validity_months: 9,
    conversion_points: 0,
    conversion_credit_cents: -5,
  });
  assert.equal(s.creditValidityMonths, 0);
  assert.equal(s.conversionPoints, 1);
  assert.equal(s.conversionCreditCents, 1);
});

test("DEFAULT tiers are ordered and start at bronze/0", () => {
  assert.equal(DEFAULT_LOYALTY_TIERS[0].code, "bronze");
  assert.equal(DEFAULT_LOYALTY_TIERS[0].minLifetimePoints, 0);
});
