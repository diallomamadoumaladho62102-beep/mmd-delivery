/**
 * Phase 5F — Food quote SoT via Pricing Engine (no legacy compute* on happy path).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDistanceAndEta } from "@/lib/mapboxRoute";
import {
  evaluateServerRoute,
  validateLocationClaimServer,
} from "@/lib/geoTrust";
import { evaluateDeliveryFeeAbnormality } from "@/lib/deliveryPricing";
import { assertFoodCheckoutCurrencyAllowed } from "@/lib/foodCurrencyGuard";
import {
  assertPlatformFeature,
  inferPlatformCountryCode,
} from "@/lib/platformLaunchControl";
import { loadFoodServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import { resolveMmdPlusCheckoutBenefits } from "@/lib/mmdPlus/mmdPlusEngine";
import {
  isLikelyFirstOrder,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";
import {
  currencyForPlatformCountry,
  loadRestaurantMenuLines,
  normalizeFoodPromoCode,
  roundFoodMoney,
  toFiniteFoodNumber,
  type FoodOrderLineInput,
  type FoodOrderPricingResult,
} from "@/lib/foodOrderServerPricing";
import { computeDeliveryFeeV1 } from "../compute/deliveryFeeV1";
import {
  computePeClientServiceFee,
  computePeServiceFeeBaseAmount,
} from "../compute/serviceFee";
import { applyOrderAndDeliveryDiscounts, sumDiscountDollars } from "../compute/discountStack";
import { assembleFoodPackageCustomerTotalCents } from "../compute/foodPackageTotals";
import { loadFoodDeliveryPricingConfig } from "../ports/deliveryPricingConfigLoader";
import { loadAndApplyFoodTax } from "../ports/taxRateLoader";
import { PE_QUOTE_ENGINE_VERSION, type PeChargeMeta } from "./types";

export type QuoteFoodInput = {
  supabaseAdmin: SupabaseClient;
  restaurantUserId: string;
  items: FoodOrderLineInput[];
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  countryCode: string;
  promoCode?: string | null;
  clientUserId?: string | null;
};

export type FoodPeQuote = FoodOrderPricingResult & {
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

export async function quoteFoodWithPricingEngine(
  input: QuoteFoodInput
): Promise<FoodPeQuote> {
  const {
    supabaseAdmin,
    restaurantUserId,
    items,
    pickupAddress,
    dropoffAddress,
    dropoffLat,
    dropoffLng,
    countryCode,
    promoCode,
    clientUserId,
  } = input;

  if (!restaurantUserId) {
    throw new Error("restaurantUserId manquant");
  }

  const { data: restaurantProfile, error: restaurantProfileError } =
    await supabaseAdmin
      .from("restaurant_profiles")
      .select("location_lat,location_lng,lat,lng,address")
      .eq("user_id", restaurantUserId)
      .maybeSingle();

  if (restaurantProfileError) {
    throw new Error(
      `Impossible de charger le restaurant: ${restaurantProfileError.message}`
    );
  }

  if (
    restaurantProfile?.location_lat == null &&
    restaurantProfile?.lat == null
  ) {
    throw new Error("restaurant_coordinates_missing");
  }
  const resolvedPickupLat = toFiniteFoodNumber(
    restaurantProfile?.location_lat ?? restaurantProfile?.lat
  );
  const resolvedPickupLng = toFiniteFoodNumber(
    restaurantProfile?.location_lng ?? restaurantProfile?.lng
  );
  const resolvedPickupAddress =
    String(restaurantProfile?.address ?? "").trim() || pickupAddress;

  validateCoordinates(resolvedPickupLat, resolvedPickupLng, "Pickup");
  validateCoordinates(dropoffLat, dropoffLng, "Dropoff");

  const [trustedPickup, trustedDropoff] = await Promise.all([
    validateLocationClaimServer({
      role: "pickup",
      address: resolvedPickupAddress,
      lat: resolvedPickupLat,
      lng: resolvedPickupLng,
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
    lat: resolvedPickupLat,
    lng: resolvedPickupLng,
  });

  const currency = currencyForPlatformCountry(platformCountry, { strict: true });
  const currencyCheck = assertFoodCheckoutCurrencyAllowed(currency);
  if (currencyCheck.ok === false) {
    throw new Error(currencyCheck.message);
  }

  const platformCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "restaurant",
    "active"
  );
  if (platformCheck.ok === false) {
    throw new Error(platformCheck.message);
  }

  const checkoutCheck = await assertPlatformFeature(
    supabaseAdmin,
    platformCountry,
    "restaurant",
    "checkout"
  );
  if (checkoutCheck.ok === false) {
    throw new Error(checkoutCheck.message);
  }

  const menuLines = await loadRestaurantMenuLines(supabaseAdmin, restaurantUserId, items);
  const subtotal = roundFoodMoney(
    menuLines.reduce((sum, line) => sum + line.line_total, 0)
  );

  const { distanceMiles, etaMinutes } = await getDistanceAndEta(
    { lat: resolvedPickupLat, lng: resolvedPickupLng },
    { lat: dropoffLat, lng: dropoffLng }
  );
  const routeTrust = evaluateServerRoute({
    pickup: { lat: resolvedPickupLat, lng: resolvedPickupLng },
    dropoff: { lat: dropoffLat, lng: dropoffLng },
    serverDistanceMiles: distanceMiles,
  });
  if (routeTrust.ok === false) throw new Error(routeTrust.code);

  const safeDistanceMiles = roundFoodMoney(toFiniteFoodNumber(distanceMiles));
  const safeEtaMinutes = Math.max(0, Math.round(toFiniteFoodNumber(etaMinutes)));

  const deliveryPricingConfig = await loadFoodDeliveryPricingConfig(supabaseAdmin, {
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

  const rawDeliveryFee = roundFoodMoney(toFiniteFoodNumber(deliveryPricing.deliveryFee));
  const driverPayoutEstimate = roundFoodMoney(
    toFiniteFoodNumber(deliveryPricing.driverPayout)
  );

  const feeAudit = evaluateDeliveryFeeAbnormality(
    rawDeliveryFee,
    { distanceMiles: safeDistanceMiles, durationMinutes: safeEtaMinutes },
    deliveryPricingConfig
  );
  if (feeAudit.abnormal) {
    console.warn("[pricingEngine.quoteFood] abnormal delivery fee", {
      ...feeAudit.details,
      reason: feeAudit.reason,
      configKey: deliveryPricingConfig.configKey,
      subtotal,
    });
  }

  const normalizedPromoCode = normalizeFoodPromoCode(promoCode);

  const { data: pricingData, error: pricingError } = await supabaseAdmin.rpc(
    "compute_order_pricing",
    {
      p_order_type: "food",
      p_subtotal: subtotal,
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
        promo_type_applied: string | null;
        promo_value_applied: number | null;
      } | undefined)
    : undefined;

  if (!pricingRow) {
    throw new Error("Pricing error: no pricing row returned");
  }

  const promoDiscountAmount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.promo_discount_amount)
  );
  const deliveryDiscountAmount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.delivery_discount_amount)
  );
  const subtotalAfterDiscount = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.subtotal_after_discount, subtotal)
  );
  const deliveryFeeAfterPromo = roundFoodMoney(
    toFiniteFoodNumber(pricingRow.delivery_fee_after_discount, rawDeliveryFee)
  );

  let marketingDiscountAmount = 0;
  let marketingDeliveryDiscountAmount = 0;
  let deliveryAfterMarketing = deliveryFeeAfterPromo;
  let subtotalAfterMarketing = subtotalAfterDiscount;

  if (clientUserId) {
    try {
      const [hasPlus, firstOrder] = await Promise.all([
        userHasActiveMmdPlus(supabaseAdmin, clientUserId),
        isLikelyFirstOrder(supabaseAdmin, clientUserId, "food"),
      ]);
      const marketing = await resolveMarketingOffers(supabaseAdmin, {
        userId: clientUserId,
        service: "food",
        subtotalCents: Math.round(subtotalAfterDiscount * 100),
        deliveryFeeCents: Math.round(deliveryFeeAfterPromo * 100),
        promoCode: promoCode ?? null,
        countryCode: platformCountry,
        partnerUserId: restaurantUserId,
        hasMmdPlus: hasPlus,
        isFirstOrder: firstOrder,
      });
      if (marketing.ok || !marketing.fail_closed) {
        marketingDiscountAmount = roundFoodMoney(
          (marketing.order_discount_cents || 0) / 100
        );
        marketingDeliveryDiscountAmount = roundFoodMoney(
          (marketing.delivery_fee_discount_cents || 0) / 100
        );
        const stacked = applyOrderAndDeliveryDiscounts({
          subtotal: subtotalAfterDiscount,
          deliveryFee: deliveryFeeAfterPromo,
          orderDiscount: marketingDiscountAmount,
          deliveryDiscount: marketingDeliveryDiscountAmount,
        });
        deliveryAfterMarketing = stacked.deliveryFeeAfterDiscount;
        subtotalAfterMarketing = stacked.subtotalAfterDiscount;
      }
    } catch (e) {
      console.warn(
        "[marketing] food PE pricing fail-open",
        e instanceof Error ? e.message : e
      );
    }
  }

  let mmdPlusDeliveryDiscountAmount = 0;
  let mmdPlusOrderDiscountAmount = 0;
  let deliveryFeeAfterDiscount = deliveryAfterMarketing;
  let subtotalForTotals = subtotalAfterMarketing;

  if (clientUserId) {
    const mmd = await resolveMmdPlusCheckoutBenefits(supabaseAdmin, {
      userId: clientUserId,
      service: "food",
      subtotalCents: Math.round(subtotalAfterMarketing * 100),
      deliveryFeeCents: Math.round(deliveryAfterMarketing * 100),
    });
    mmdPlusDeliveryDiscountAmount = roundFoodMoney(
      (mmd.delivery_fee_discount_cents || 0) / 100
    );
    mmdPlusOrderDiscountAmount = roundFoodMoney(
      (mmd.order_discount_cents || 0) / 100
    );
    const stacked = applyOrderAndDeliveryDiscounts({
      subtotal: subtotalAfterMarketing,
      deliveryFee: deliveryAfterMarketing,
      orderDiscount: mmdPlusOrderDiscountAmount,
      deliveryDiscount: mmdPlusDeliveryDiscountAmount,
    });
    deliveryFeeAfterDiscount = stacked.deliveryFeeAfterDiscount;
    subtotalForTotals = stacked.subtotalAfterDiscount;
  }

  const taxResult = await loadAndApplyFoodTax(
    supabaseAdmin,
    platformCountry,
    subtotalForTotals
  );

  const serviceFeeConfig = await loadFoodServiceFeeConfig(supabaseAdmin, {
    countryCode: platformCountry,
    currency,
    lat: dropoffLat,
    lng: dropoffLng,
  });
  const serviceFeeBase = computePeServiceFeeBaseAmount({
    subtotalAfterDiscount: subtotalForTotals,
    deliveryFeeAfterDiscount,
  });
  const serviceFeeResult = computePeClientServiceFee(serviceFeeConfig, serviceFeeBase);
  const discounts = sumDiscountDollars(
    promoDiscountAmount,
    deliveryDiscountAmount,
    marketingDiscountAmount,
    marketingDeliveryDiscountAmount,
    mmdPlusDeliveryDiscountAmount,
    mmdPlusOrderDiscountAmount
  );
  const totalCents = assembleFoodPackageCustomerTotalCents({
    subtotalAfterDiscount: subtotalForTotals,
    tax: taxResult.tax,
    deliveryFee: deliveryFeeAfterDiscount,
    serviceFee: serviceFeeResult.serviceFee,
  });
  const total = roundFoodMoney(totalCents / 100);

  return {
    countryCode: platformCountry,
    currency,
    configKey: deliveryPricingConfig.configKey,
    items: menuLines,
    subtotal,
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
    marketingDiscountAmount,
    marketingDeliveryDiscountAmount,
    mmdPlusDeliveryDiscountAmount,
    mmdPlusOrderDiscountAmount,
    promoCodeApplied: pricingRow.promo_code_applied ?? null,
    promoTypeApplied: pricingRow.promo_type_applied ?? null,
    promoValueApplied:
      pricingRow.promo_value_applied != null
        ? roundFoodMoney(toFiniteFoodNumber(pricingRow.promo_value_applied))
        : null,
    promoDiscountAmount,
    discounts,
    subtotalAfterDiscount: subtotalForTotals,
    total,
    totalCents,
    distanceMiles: safeDistanceMiles,
    etaMinutes: safeEtaMinutes,
    driverPayoutEstimate,
    pickupLat: resolvedPickupLat,
    pickupLng: resolvedPickupLng,
    pickupAddress: trustedPickup.canonicalAddress ?? resolvedPickupAddress,
    pe: {
      chargePath: "engine",
      engineVersion: PE_QUOTE_ENGINE_VERSION,
      failOpen: false,
      source: "pricing_engine_sot",
    },
  };
}
