/**
 * Phase 5B — Food adapter.
 * Legacy side: normalize capture for shadow / fail-open (no PE formula).
 * Engine side: PE-owned delivery fee V1 + total assembly (no legacy SoT imports).
 */
import type { FoodOrderPricingResult } from "@/lib/foodOrderServerPricing";
import { assembleComparableQuoteFromParts } from "../assembleQuote";
import {
  computeDeliveryFeeV1,
  splitDeliveryFeeV1,
} from "../compute/deliveryFeeV1";
import {
  assembleFoodPackageCustomerTotalCents,
  foodPackageFeeCents,
} from "../compute/foodPackageTotals";
import { dollarsToCents, roundMoney2 } from "../compute/money";
import type { ComparableQuote } from "../../shadow/comparableQuote";

/**
 * Legacy normalization + Engine independent compute for Food.
 */
export function buildFoodComparablePair(pricing: FoodOrderPricingResult): {
  legacy: ComparableQuote;
  engine: ComparableQuote;
} {
  const baseCents = dollarsToCents(pricing.subtotal);
  const taxCents = dollarsToCents(pricing.tax);
  const feeCents = foodPackageFeeCents(pricing.deliveryFee, pricing.serviceFee);
  const promotionCents = dollarsToCents(pricing.discounts);
  const driverCents = dollarsToCents(pricing.driverPayoutEstimate);
  const platformDeliveryCents = dollarsToCents(
    Math.max(0, pricing.deliveryFeeRaw - pricing.driverPayoutEstimate)
  );
  const platformRevenueCents =
    platformDeliveryCents + dollarsToCents(pricing.serviceFee) + taxCents;

  const legacyParts = assembleComparableQuoteFromParts({
    service: "food",
    currency: pricing.currency,
    baseCents,
    taxCents,
    feeCents,
    promotionCents,
    customerTotalCents: pricing.totalCents,
    driverEarningsCents: driverCents,
    restaurantEarningsCents: null,
    sellerEarningsCents: null,
    platformRevenueCents,
    legacyVersion: "legacy-food-v1",
    meta: { configKey: pricing.configKey, taxSource: pricing.taxSource, side: "legacy" },
  });
  if (!legacyParts.ok) {
    throw new Error(`food_legacy_assemble_failed:${legacyParts.reason}`);
  }

  // Engine SoT: PE delivery V1 from captured distance/time (no Mapbox, no legacy module).
  const peDelivery = computeDeliveryFeeV1({
    distanceMiles: pricing.distanceMiles,
    durationMinutes: pricing.etaMinutes,
  });

  // Customer delivery line: after-discount amount from capture inputs (promo IO upstream).
  // When no delivery discount, PE raw fee is the functional SoT and must match capture.
  const deliveryForCustomer = Number(pricing.deliveryFee) || 0;
  const peSplitForCommission =
    Math.abs(peDelivery.deliveryFee - (Number(pricing.deliveryFeeRaw) || 0)) < 0.005
      ? peDelivery
      : splitDeliveryFeeV1(Number(pricing.deliveryFeeRaw) || deliveryForCustomer);

  const engineCustomerTotalCents = assembleFoodPackageCustomerTotalCents({
    subtotalAfterDiscount: pricing.subtotalAfterDiscount,
    tax: pricing.tax,
    deliveryFee: deliveryForCustomer,
    serviceFee: pricing.serviceFee,
  });
  const engineFeeCents = foodPackageFeeCents(
    deliveryForCustomer,
    pricing.serviceFee
  );
  const engineDriverCents = dollarsToCents(peSplitForCommission.driverPayout);
  const enginePlatformDeliveryCents = dollarsToCents(
    peSplitForCommission.platformFee
  );
  const enginePlatformRevenueCents =
    enginePlatformDeliveryCents +
    dollarsToCents(pricing.serviceFee) +
    taxCents;

  const engineParts = assembleComparableQuoteFromParts({
    service: "food",
    currency: pricing.currency,
    baseCents,
    taxCents,
    feeCents: engineFeeCents,
    promotionCents,
    customerTotalCents: engineCustomerTotalCents,
    driverEarningsCents: engineDriverCents,
    restaurantEarningsCents: null,
    sellerEarningsCents: null,
    platformRevenueCents: enginePlatformRevenueCents,
    legacyVersion: "legacy-food-v1",
    meta: {
      configKey: pricing.configKey,
      side: "engine",
      sot: "pricing-engine",
      peDeliveryFee: peDelivery.deliveryFee,
      peDriverPayout: peDelivery.driverPayout,
      pePlatformFee: peDelivery.platformFee,
      capturedDeliveryFeeRaw: pricing.deliveryFeeRaw,
      deliveryRecomputeDiff: roundMoney2(
        peDelivery.deliveryFee - (Number(pricing.deliveryFeeRaw) || 0)
      ),
    },
  });
  if (!engineParts.ok) {
    throw new Error(`food_engine_assemble_failed:${engineParts.reason}`);
  }

  return { legacy: legacyParts.quote, engine: engineParts.quote };
}
