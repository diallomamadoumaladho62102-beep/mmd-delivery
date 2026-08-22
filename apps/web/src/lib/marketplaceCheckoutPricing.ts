import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceCheckoutShadow } from "@/lib/marketplaceCheckout";
import { resolveMmdPlusCheckoutBenefits } from "@/lib/mmdPlus/mmdPlusEngine";
import {
  isLikelyFirstOrder,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";

/** PE output before marketing / MMD+ adjustments — shared shadow + live checkout SoT. */
export type MarketplaceCheckoutPricingBase = {
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
  checkout_enabled: boolean;
  message: string | null;
  pricing_engine_version: "marketplace_checkout_shadow_v2";
};

/**
 * Applies marketing + MMD+ discounts on top of pricing-engine totals.
 * Used by shadow checkout and live checkout so client quote = Stripe amount.
 */
export async function applyMarketplaceCheckoutBenefits(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    sellerId: string;
    countryCode: string | null;
    shadowBase: MarketplaceCheckoutPricingBase;
  }
): Promise<MarketplaceCheckoutShadow> {
  const [hasPlus, firstOrder] = await Promise.all([
    userHasActiveMmdPlus(supabaseAdmin, params.clientUserId),
    isLikelyFirstOrder(supabaseAdmin, params.clientUserId, "marketplace"),
  ]);

  const marketing = await resolveMarketingOffers(supabaseAdmin, {
    userId: params.clientUserId,
    service: "marketplace",
    subtotalCents: params.shadowBase.subtotal_cents,
    deliveryFeeCents: params.shadowBase.delivery_fee_cents,
    countryCode: params.countryCode,
    partnerUserId: params.sellerId,
    hasMmdPlus: hasPlus,
    isFirstOrder: firstOrder,
  });

  const marketingOrder =
    marketing.ok || !marketing.fail_closed ? marketing.order_discount_cents : 0;
  const marketingFee =
    marketing.ok || !marketing.fail_closed
      ? marketing.delivery_fee_discount_cents
      : 0;

  const mmdPlus = await resolveMmdPlusCheckoutBenefits(supabaseAdmin, {
    userId: params.clientUserId,
    service: "marketplace",
    subtotalCents: Math.max(0, params.shadowBase.subtotal_cents - marketingOrder),
    deliveryFeeCents: Math.max(0, params.shadowBase.delivery_fee_cents - marketingFee),
  });

  const deliveryFeeCents = Math.max(
    0,
    params.shadowBase.delivery_fee_cents -
      marketingFee -
      mmdPlus.delivery_fee_discount_cents
  );
  const subtotalCents = Math.max(
    0,
    params.shadowBase.subtotal_cents -
      marketingOrder -
      mmdPlus.order_discount_cents
  );

  return {
    ...params.shadowBase,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents:
      subtotalCents + deliveryFeeCents + params.shadowBase.service_fee_cents,
    marketing: {
      order_discount_cents: marketingOrder,
      delivery_fee_discount_cents: marketingFee,
      applied: marketing.applied,
    },
    mmd_plus: {
      delivery_fee_discount_cents: mmdPlus.delivery_fee_discount_cents,
      order_discount_cents: mmdPlus.order_discount_cents,
      active: mmdPlus.active,
    },
  };
}
