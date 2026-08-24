/**
 * Phase 5F — Package / delivery-request quote SoT via Pricing Engine.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import {
  evaluateServerRoute,
  validateLocationClaimServer,
} from "@/lib/geoTrust";
import { assertFoodCheckoutCurrencyAllowed } from "@/lib/foodCurrencyGuard";
import {
  assertPlatformFeature,
  inferPlatformCountryCode,
} from "@/lib/platformLaunchControl";
import { loadErrandServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import { resolveMmdPlusCheckoutBenefits } from "@/lib/mmdPlus/mmdPlusEngine";
import {
  isLikelyFirstOrder,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";
import {
  currencyForPlatformCountry,
  roundPlatformMoney,
} from "@/lib/platformCurrency";
import type { DeliveryRequestPricingResult } from "@/lib/deliveryRequestServerPricing";
import { computeDeliveryFeeV1 } from "../compute/deliveryFeeV1";
import {
  computePeClientServiceFee,
  computePeServiceFeeBaseAmount,
} from "../compute/serviceFee";
import { applyOrderAndDeliveryDiscounts, sumDiscountDollars } from "../compute/discountStack";
import { assembleFoodPackageCustomerTotalCents } from "../compute/foodPackageTotals";
import { loadErrandDeliveryPricingConfig } from "../ports/deliveryPricingConfigLoader";
import { loadAndApplyFoodTax } from "../ports/taxRateLoader";
import { PE_QUOTE_ENGINE_VERSION, type PeChargeMeta } from "./types";

export type QuotePackageInput = {
  supabaseAdmin: SupabaseClient;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  countryCode: string;
  promoCode?: string | null;
  subtotal?: number;
  clientUserId?: string | null;
};

export type PackagePeQuote = DeliveryRequestPricingResult & {
  pe: PeChargeMeta;
};

function validateCoordinates(lat: number, lng: number, prefix: string) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${prefix} latitude invalide`);
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`${prefix} longitude invalide`);
  }
}

function toFinite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePromoCode(value?: string | null) {
  const text = String(value ?? "").trim().toUpperCase();
  return text || null;
}

export async function quotePackageWithPricingEngine(
  input: QuotePackageInput
): Promise<PackagePeQuote> {
  const {
    supabaseAdmin,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    countryCode,
    promoCode,
    subtotal = 0,
    clientUserId,
  } = input;

  validateCoordinates(pickupLat, pickupLng, "Pickup");
  validateCoordinates(dropoffLat, dropoffLng, "Dropoff");

  const [trustedPickup, trustedDropoff] = await Promise.all([
    validateLocationClaimServer({
      role: "pickup",
      address: pickupAddress,
      lat: pickupLat,
      lng: pickupLng,
      claimedCountryCode: countryCode,
    }),
    validateLocationClaimServer({
      role: "dropoff",
      address: dropoffAddress,
      lat: dropoffLat,
      lng: dropoffLng,
      claimedCountryCode: countryCode,
    }),
  ]);

  if (
    trustedPickup.countryCode &&
    trustedDropoff.countryCode &&
    trustedPickup.countryCode !== trustedDropoff.countryCode
  ) {
    throw new Error("cross_country_route_not_supported");
  }

  const platformCountry = inferPlatformCountryCode({
    countryCode: trustedPickup.countryCode ?? countryCode,
    lat: pickupLat,
    lng: pickupLng,
  });

  const currency = currencyForPlatformCountry(platformCountry, { strict: true });
  const currencyCheck = assertFoodCheckoutCurrencyAllowed(currency);
  if (currencyCheck.ok === false) {
    throw new Error(currencyCheck.message);
  }

  const platformCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "delivery",
    "active"
  );
  if (platformCheck.ok === false) {
    throw new Error(platformCheck.message);
  }

  const checkoutCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "delivery",
    "checkout"
  );
  if (checkoutCheck.ok === false) {
    throw new Error(checkoutCheck.message);
  }

  const safeSubtotal = roundPlatformMoney(Math.max(toFinite(subtotal), 0));

  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );

  const routeTrust = evaluateServerRoute({
    pickup: { lat: pickupLat, lng: pickupLng },
    dropoff: { lat: dropoffLat, lng: dropoffLng },
    serverDistanceMiles: distanceMiles,
    service: "delivery",
  });
  if (routeTrust.ok === false) throw new Error(routeTrust.code);

  const safeDistanceMiles = roundPlatformMoney(toFinite(distanceMiles));
  const safeEtaMinutes = Math.max(0, Math.round(toFinite(etaMinutes)));

  const deliveryPricingConfig = await loadErrandDeliveryPricingConfig(supabaseAdmin, {
    countryCode: platformCountry,
    currency,
    lat: dropoffLat,
    lng: dropoffLng,
  });

  const deliveryPricing = computeDeliveryFeeV1(
    {
      distanceMiles: safeDistanceMiles,
      durationMinutes: safeEtaMinutes,
    },
    deliveryPricingConfig
  );

  const rawDeliveryFee = roundPlatformMoney(toFinite(deliveryPricing.deliveryFee));
  const driverPayoutEstimate = roundPlatformMoney(
    toFinite(deliveryPricing.driverPayout)
  );
  const normalizedPromoCode = normalizePromoCode(promoCode);

  const { data: pricingData, error: pricingError } = await supabaseAdmin.rpc(
    "compute_order_pricing",
    {
      p_order_type: "errand",
      p_subtotal: safeSubtotal,
      p_delivery_fee: rawDeliveryFee,
      p_currency: currency,
      p_promo_code: normalizedPromoCode,
      p_country_code: platformCountry,
    }
  );

  if (pricingError) {
    throw new Error(`Pricing error: ${pricingError.message}`);
  }

  const pricingRow = Array.isArray(pricingData)
    ? (pricingData[0] as {
        promo_discount_amount: number;
        delivery_discount_amount: number;
        subtotal_after_discount: number;
        delivery_fee_after_discount: number;
        promo_code_applied: string | null;
      } | undefined)
    : undefined;

  if (!pricingRow) {
    throw new Error("Pricing error: no pricing row returned");
  }

  const promoDiscountAmount = roundPlatformMoney(
    toFinite(pricingRow.promo_discount_amount)
  );
  const deliveryDiscountAmount = roundPlatformMoney(
    toFinite(pricingRow.delivery_discount_amount)
  );
  const subtotalAfterPromo = roundPlatformMoney(
    toFinite(pricingRow.subtotal_after_discount, safeSubtotal)
  );
  const deliveryFeeAfterPromo = roundPlatformMoney(
    toFinite(pricingRow.delivery_fee_after_discount, rawDeliveryFee)
  );

  let deliveryFeeAfterDiscount = deliveryFeeAfterPromo;
  let subtotalAfterDiscount = subtotalAfterPromo;
  let marketingOrderDiscount = 0;
  let marketingFeeDiscount = 0;
  let mmdPlusDeliveryDiscount = 0;
  let mmdPlusOrderDiscount = 0;

  if (clientUserId) {
    try {
      const [hasPlus, firstOrder] = await Promise.all([
        userHasActiveMmdPlus(supabaseAdmin, clientUserId),
        isLikelyFirstOrder(supabaseAdmin, clientUserId, "delivery"),
      ]);
      const marketing = await resolveMarketingOffers(supabaseAdmin, {
        userId: clientUserId,
        service: "delivery",
        subtotalCents: Math.round(subtotalAfterPromo * 100),
        deliveryFeeCents: Math.round(deliveryFeeAfterPromo * 100),
        promoCode: promoCode ?? null,
        countryCode: platformCountry,
        hasMmdPlus: hasPlus,
        isFirstOrder: firstOrder,
      });
      if (marketing.ok || !marketing.fail_closed) {
        marketingOrderDiscount = roundPlatformMoney(
          (marketing.order_discount_cents || 0) / 100
        );
        marketingFeeDiscount = roundPlatformMoney(
          (marketing.delivery_fee_discount_cents || 0) / 100
        );
        const stacked = applyOrderAndDeliveryDiscounts({
          subtotal: subtotalAfterPromo,
          deliveryFee: deliveryFeeAfterPromo,
          orderDiscount: marketingOrderDiscount,
          deliveryDiscount: marketingFeeDiscount,
        });
        deliveryFeeAfterDiscount = stacked.deliveryFeeAfterDiscount;
        subtotalAfterDiscount = stacked.subtotalAfterDiscount;
      }
    } catch (e) {
      console.warn(
        "[marketing] delivery PE pricing fail-open",
        e instanceof Error ? e.message : e
      );
    }

    const mmd = await resolveMmdPlusCheckoutBenefits(supabaseAdmin, {
      userId: clientUserId,
      service: "delivery",
      subtotalCents: Math.round(subtotalAfterDiscount * 100),
      deliveryFeeCents: Math.round(deliveryFeeAfterDiscount * 100),
    });
    mmdPlusDeliveryDiscount = roundPlatformMoney(
      (mmd.delivery_fee_discount_cents || 0) / 100
    );
    mmdPlusOrderDiscount = roundPlatformMoney((mmd.order_discount_cents || 0) / 100);
    const stacked = applyOrderAndDeliveryDiscounts({
      subtotal: subtotalAfterDiscount,
      deliveryFee: deliveryFeeAfterDiscount,
      orderDiscount: mmdPlusOrderDiscount,
      deliveryDiscount: mmdPlusDeliveryDiscount,
    });
    deliveryFeeAfterDiscount = stacked.deliveryFeeAfterDiscount;
    subtotalAfterDiscount = stacked.subtotalAfterDiscount;
  }

  const taxResult = await loadAndApplyFoodTax(
    supabaseAdmin,
    platformCountry,
    subtotalAfterDiscount
  );

  const serviceFeeConfig = await loadErrandServiceFeeConfig(supabaseAdmin, {
    countryCode: platformCountry,
    currency,
    lat: dropoffLat,
    lng: dropoffLng,
  });
  const serviceFeeBase = computePeServiceFeeBaseAmount({
    subtotalAfterDiscount,
    deliveryFeeAfterDiscount,
  });
  const serviceFeeResult = computePeClientServiceFee(serviceFeeConfig, serviceFeeBase);
  const discounts = sumDiscountDollars(
    promoDiscountAmount,
    deliveryDiscountAmount,
    marketingOrderDiscount,
    marketingFeeDiscount,
    mmdPlusDeliveryDiscount,
    mmdPlusOrderDiscount
  );
  const totalCents = assembleFoodPackageCustomerTotalCents({
    subtotalAfterDiscount,
    tax: taxResult.tax,
    deliveryFee: deliveryFeeAfterDiscount,
    serviceFee: serviceFeeResult.serviceFee,
  });
  const total = roundPlatformMoney(totalCents / 100);

  return {
    countryCode: platformCountry,
    currency,
    configKey: deliveryPricingConfig.configKey,
    subtotal: safeSubtotal,
    tax: taxResult.tax,
    taxRatePct: taxResult.taxRatePct,
    taxSource: taxResult.taxSource,
    serviceFee: serviceFeeResult.serviceFee,
    serviceFeeCents: serviceFeeResult.serviceFeeCents,
    serviceFeePct: serviceFeeResult.pct,
    serviceFeeEnabled: serviceFeeResult.enabled,
    serviceFeeFixedCents: serviceFeeResult.fixedCents,
    deliveryFeeRaw: rawDeliveryFee,
    deliveryFee: deliveryFeeAfterDiscount,
    deliveryDiscountAmount,
    promoCodeApplied: pricingRow.promo_code_applied ?? null,
    promoDiscountAmount,
    discounts,
    subtotalAfterDiscount,
    marketingDiscountAmount: marketingOrderDiscount,
    marketingDeliveryDiscountAmount: marketingFeeDiscount,
    total,
    totalCents,
    distanceMiles: safeDistanceMiles,
    etaMinutes: safeEtaMinutes,
    driverPayoutEstimate,
    pe: {
      chargePath: "engine",
      engineVersion: PE_QUOTE_ENGINE_VERSION,
      failOpen: false,
      source: "pricing_engine_sot",
    },
  };
}
