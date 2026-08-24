/**
 * Server-authoritative discounts for taxi pay-then-create checkout.
 * Never trust mobile discount cents — validate/reserve on the server only.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  campaignIdsFromReserve,
  totalMarketingDiscountCents,
} from "@/lib/marketing/marketingCheckoutLifecycle";
import {
  isLikelyFirstOrder,
  reserveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";

export type TaxiCheckoutDiscountResolution =
  | {
      ok: true;
      checkout_entity_id: string;
      promo_code: string | null;
      promotion_id: string | null;
      promo_discount_cents: number;
      marketing_discount_cents: number;
      marketing_reservation_id: string | null;
      marketing_campaign_ids: string[];
    }
  | { ok: false; error: string; httpStatus: number };

function toPositiveInt(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Align checkout commission with quote_taxi_ride SoT (single money truth):
 * - Driver share = (subtotal - discounts) × (quoteDriver / subtotal)
 *   same ratio quote_taxi_ride used on the pre-discount subtotal
 * - Tax is customer pass-through (never driver revenue)
 * - Service fee is 100% MMD (lands in platform_fee remainder)
 * - Discounts reduce fare only (not tax / service fee)
 *
 * Cash identity: driver_payout + platform_fee + tax_cents = customerNetTotal
 * (platform absorbs rounding / share-gap / service fee).
 */
export function splitTaxiNetCommissionCents(params: {
  /** What the customer pays after all discounts (Stripe amount). */
  customerNetTotalCents: number;
  /** Quote SoT driver share of subtotal (before discounts). */
  quoteDriverPayoutCents: number;
  /** Quote SoT platform share of subtotal (before discounts / service fee). */
  quotePlatformFeeCents: number;
  /** Quote subtotal (fare) before discounts — same base as quote_taxi_ride. */
  subtotalCents: number;
  /** Client service fee cents (100% MMD). */
  serviceFeeCents?: number;
  /** Tax cents charged to customer (not driver revenue). */
  taxCents?: number;
  /** Total discounts reducing the customer total. */
  discountCents?: number;
}): { driver_payout_cents: number; platform_fee_cents: number } {
  const customerNet = Math.max(
    0,
    Math.round(Number(params.customerNetTotalCents ?? 0)),
  );
  const quoteDriver = Math.max(
    0,
    Math.round(Number(params.quoteDriverPayoutCents ?? 0)),
  );
  const subtotal = Math.max(0, Math.round(Number(params.subtotalCents ?? 0)));
  const tax = Math.max(0, Math.round(Number(params.taxCents ?? 0)));
  const discounts = Math.max(0, Math.round(Number(params.discountCents ?? 0)));

  if (customerNet <= 0) {
    return { driver_payout_cents: 0, platform_fee_cents: 0 };
  }

  const fareNet = Math.max(0, subtotal - discounts);

  let driver = 0;
  if (subtotal > 0 && fareNet > 0 && quoteDriver > 0) {
    // Preserve quote_taxi_ride's rounded driver/subtotal ratio after discounts.
    driver = Math.max(0, Math.round((fareNet * quoteDriver) / subtotal));
  }

  // Driver never exceeds (customerNet - tax). Remainder (incl. service fee) → MMD.
  const maxDriver = Math.max(0, customerNet - tax);
  driver = Math.min(driver, maxDriver);
  const platform = Math.max(0, customerNet - tax - driver);

  return {
    driver_payout_cents: driver,
    platform_fee_cents: platform,
  };
}

/**
 * Resolve promo/marketing discounts for a taxi quote checkout.
 * Fail-closed when the client supplies a code that cannot be applied.
 */
export async function resolveTaxiCheckoutDiscounts(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  promoCode?: string | null;
  fareBasisCents: number;
  subtotalCents: number;
  vehicleClass?: string | null;
  countryCode?: string | null;
  currency?: string | null;
  city?: string | null;
}): Promise<TaxiCheckoutDiscountResolution> {
  const promoCode = String(params.promoCode ?? "").trim();
  const checkoutEntityId = randomUUID();

  if (!promoCode) {
    return {
      ok: true,
      checkout_entity_id: checkoutEntityId,
      promo_code: null,
      promotion_id: null,
      promo_discount_cents: 0,
      marketing_discount_cents: 0,
      marketing_reservation_id: null,
      marketing_campaign_ids: [],
    };
  }

  const fareBasis = toPositiveInt(params.fareBasisCents);
  const [hasPlus, firstOrder] = await Promise.all([
    userHasActiveMmdPlus(params.supabaseAdmin, params.userId),
    isLikelyFirstOrder(params.supabaseAdmin, params.userId, "taxi"),
  ]);

  const marketing = await reserveMarketingOffers(params.supabaseAdmin, {
    userId: params.userId,
    service: "taxi",
    entityType: "taxi_checkout_intent",
    entityId: checkoutEntityId,
    idempotencyKey: `marketing:taxi_checkout:${checkoutEntityId}:reserve`,
    subtotalCents: Math.max(0, Math.round(Number(params.subtotalCents ?? 0))),
    deliveryFeeCents: 0,
    promoCode,
    countryCode: params.countryCode ?? null,
    city: params.city ?? null,
    hasMmdPlus: hasPlus,
    isFirstOrder: firstOrder,
    ttlMinutes: 45,
  });

  // Explicit code + marketing fail-closed → reject (invalid/expired/private).
  if (marketing.fail_closed && marketing.ok === false) {
    return {
      ok: false,
      error: String(marketing.error ?? "promotion_invalid"),
      httpStatus: 400,
    };
  }

  const marketingDiscount = totalMarketingDiscountCents(marketing);
  if (marketingDiscount > 0) {
    return {
      ok: true,
      checkout_entity_id: checkoutEntityId,
      promo_code: promoCode.toUpperCase(),
      promotion_id: null,
      promo_discount_cents: 0,
      marketing_discount_cents: marketingDiscount,
      marketing_reservation_id: marketing.reservation_id
        ? String(marketing.reservation_id)
        : null,
      marketing_campaign_ids: campaignIdsFromReserve(marketing),
    };
  }

  const { data: validation, error: validationError } =
    await params.supabaseAdmin.rpc("validate_taxi_promotion", {
      p_code: promoCode,
      p_user_id: params.userId,
      p_total_cents: fareBasis > 0 ? fareBasis : null,
      p_ride_id: null,
      p_vehicle_class: String(params.vehicleClass ?? "").trim() || null,
      p_country_code: String(params.countryCode ?? "").trim() || null,
      p_currency: String(params.currency ?? "").trim() || null,
    });

  if (validationError) {
    return {
      ok: false,
      error: validationError.message,
      httpStatus: 500,
    };
  }

  const result = (validation ?? {}) as Record<string, unknown>;
  const msg = String(result.error ?? result.message ?? "");
  if (result.ok === false) {
    return {
      ok: false,
      error: msg || "promotion_invalid",
      httpStatus: 400,
    };
  }

  const promoDiscount = Math.max(0, Math.round(Number(result.discount_cents ?? 0)));
  if (promoDiscount <= 0) {
    return {
      ok: false,
      error: "promotion_discount_zero",
      httpStatus: 400,
    };
  }

  return {
    ok: true,
    checkout_entity_id: checkoutEntityId,
    promo_code:
      String(result.code ?? promoCode).trim().toUpperCase() ||
      promoCode.toUpperCase(),
    promotion_id: String(result.promotion_id ?? "").trim() || null,
    promo_discount_cents: promoDiscount,
    marketing_discount_cents: 0,
    marketing_reservation_id: null,
    marketing_campaign_ids: [],
  };
}

/**
 * After pay-then-create materialize (PI succeeded + ride inserted as paid),
 * consume classic taxi promo the same way mark_taxi_ride_paid does:
 * revalidate → finalize_taxi_promotion_redemption (idempotent per ride).
 *
 * Failed / abandoned Checkout never reaches this path, so promo is not consumed.
 */
export async function finalizeTaxiPromotionAfterPaidMaterialize(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
  promoCode?: string | null;
  fareBasisCents?: number | null;
  vehicleClass?: string | null;
  countryCode?: string | null;
  currency?: string | null;
  clientUserId?: string | null;
}): Promise<{ ok: true; skipped?: boolean; already?: boolean } | { ok: false; error: string }> {
  const rideId = String(params.taxiRideId ?? "").trim();
  if (!rideId) {
    return { ok: false, error: "missing_taxi_ride_id" };
  }

  const promoCode = String(params.promoCode ?? "").trim();
  if (promoCode && params.clientUserId) {
    const fareBasis = Math.max(0, Math.round(Number(params.fareBasisCents ?? 0)));
    const { data: validation, error: validationError } =
      await params.supabaseAdmin.rpc("validate_taxi_promotion", {
        p_code: promoCode,
        p_user_id: params.clientUserId,
        p_total_cents: fareBasis > 0 ? fareBasis : null,
        p_ride_id: rideId,
        p_vehicle_class: String(params.vehicleClass ?? "").trim() || null,
        p_country_code: String(params.countryCode ?? "").trim() || null,
        p_currency: String(params.currency ?? "").trim() || null,
      });

    if (validationError) {
      console.warn(
        "[taxi quote-checkout] promo revalidate error",
        validationError.message,
      );
      return { ok: false, error: validationError.message };
    }

    const result = (validation ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      console.warn(
        "[taxi quote-checkout] promo revalidate refused after paid materialize",
        {
          rideId,
          message: String(result.message ?? result.error ?? "promotion_invalid"),
        },
      );
      // Payment already captured — do not consume redemption when no longer valid.
      return {
        ok: false,
        error: String(result.message ?? result.error ?? "promotion_invalid"),
      };
    }
  }

  const { data, error } = await params.supabaseAdmin.rpc(
    "finalize_taxi_promotion_redemption",
    { p_ride_id: rideId },
  );

  if (error) {
    console.warn("[taxi quote-checkout] promo finalize error", error.message);
    return { ok: false, error: error.message };
  }

  const body = (data ?? {}) as Record<string, unknown>;
  if (body.ok === false) {
    return {
      ok: false,
      error: String(body.message ?? body.error ?? "promo_finalize_failed"),
    };
  }

  return {
    ok: true,
    skipped: body.skipped === true,
    already: body.already === true,
  };
}
