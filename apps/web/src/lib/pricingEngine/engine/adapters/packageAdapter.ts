/**
 * Phase 5B — Package adapter.
 * Legacy side: normalize capture for shadow / fail-open.
 * Engine side: PE-owned fee split + total assembly (optional PE delivery V1 when miles present).
 */
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

export type DeliveryQuoteCapture = {
  currency: string;
  subtotal: number;
  tax: number;
  deliveryFee: number;
  serviceFee: number;
  discounts: number;
  totalCents: number;
  driverPayoutEstimate: number;
  deliveryFeeRaw?: number;
  /** Optional — when present, Engine recomputes delivery V1 independently. */
  distanceMiles?: number;
  etaMinutes?: number;
  subtotalAfterDiscount?: number;
};

export function buildPackageComparablePair(
  pricing: DeliveryQuoteCapture
): { legacy: ComparableQuote; engine: ComparableQuote } {
  const raw = Number(pricing.deliveryFeeRaw ?? pricing.deliveryFee) || 0;
  const baseCents = dollarsToCents(pricing.subtotal);
  const taxCents = dollarsToCents(pricing.tax);
  const feeCents = foodPackageFeeCents(pricing.deliveryFee, pricing.serviceFee);
  const promotionCents = dollarsToCents(pricing.discounts);
  const driverCents = dollarsToCents(pricing.driverPayoutEstimate);
  const platformDeliveryCents = dollarsToCents(
    Math.max(0, raw - pricing.driverPayoutEstimate)
  );
  const platformRevenueCents =
    platformDeliveryCents + dollarsToCents(pricing.serviceFee) + taxCents;

  const legacyParts = assembleComparableQuoteFromParts({
    service: "package",
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
    legacyVersion: "legacy-package-v1",
    meta: { side: "legacy" },
  });
  if (!legacyParts.ok) {
    throw new Error(`package_legacy_assemble_failed:${legacyParts.reason}`);
  }

  const hasDistance =
    pricing.distanceMiles != null &&
    pricing.etaMinutes != null &&
    Number.isFinite(Number(pricing.distanceMiles)) &&
    Number.isFinite(Number(pricing.etaMinutes));

  const peDelivery = hasDistance
    ? computeDeliveryFeeV1({
        distanceMiles: Number(pricing.distanceMiles),
        durationMinutes: Number(pricing.etaMinutes),
      })
    : null;

  const deliveryForCustomer = Number(pricing.deliveryFee) || 0;
  const peSplit =
    peDelivery && Math.abs(peDelivery.deliveryFee - raw) < 0.005
      ? peDelivery
      : splitDeliveryFeeV1(raw);

  const subtotalAfter =
    pricing.subtotalAfterDiscount != null
      ? Number(pricing.subtotalAfterDiscount)
      : Number(pricing.subtotal) || 0;

  const engineCustomerTotalCents = assembleFoodPackageCustomerTotalCents({
    subtotalAfterDiscount: subtotalAfter,
    tax: pricing.tax,
    deliveryFee: deliveryForCustomer,
    serviceFee: pricing.serviceFee,
  });

  const engineParts = assembleComparableQuoteFromParts({
    service: "package",
    currency: pricing.currency,
    baseCents,
    taxCents,
    feeCents: foodPackageFeeCents(deliveryForCustomer, pricing.serviceFee),
    promotionCents,
    customerTotalCents: engineCustomerTotalCents,
    driverEarningsCents: dollarsToCents(peSplit.driverPayout),
    restaurantEarningsCents: null,
    sellerEarningsCents: null,
    platformRevenueCents:
      dollarsToCents(peSplit.platformFee) +
      dollarsToCents(pricing.serviceFee) +
      taxCents,
    legacyVersion: "legacy-package-v1",
    meta: {
      side: "engine",
      sot: "pricing-engine",
      peDeliveryFee: peDelivery?.deliveryFee ?? null,
      peDriverPayout: peSplit.driverPayout,
      deliveryRecomputeDiff: peDelivery
        ? roundMoney2(peDelivery.deliveryFee - raw)
        : null,
    },
  });
  if (!engineParts.ok) {
    throw new Error(`package_engine_assemble_failed:${engineParts.reason}`);
  }

  return { legacy: legacyParts.quote, engine: engineParts.quote };
}
