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

/** Split net fare into driver/platform using the pre-discount ratio. */
export function splitTaxiNetCommissionCents(params: {
  netTotalCents: number;
  driverPayoutCents: number;
  platformFeeCents: number;
}): { driver_payout_cents: number; platform_fee_cents: number } {
  const net = Math.max(0, Math.round(Number(params.netTotalCents ?? 0)));
  const driverGross = Math.max(0, Math.round(Number(params.driverPayoutCents ?? 0)));
  const platformGross = Math.max(0, Math.round(Number(params.platformFeeCents ?? 0)));
  const parts = driverGross + platformGross;
  if (net <= 0) {
    return { driver_payout_cents: 0, platform_fee_cents: 0 };
  }
  if (parts <= 0) {
    return { driver_payout_cents: net, platform_fee_cents: 0 };
  }
  const driver = Math.max(0, Math.round((net * driverGross) / parts));
  return {
    driver_payout_cents: driver,
    platform_fee_cents: Math.max(0, net - driver),
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
