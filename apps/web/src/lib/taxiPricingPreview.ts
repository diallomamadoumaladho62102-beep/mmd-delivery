/**
 * Taxi pricing admin preview helpers.
 *
 * Fare / tax / driver / platform shares come from RPC `quote_taxi_ride`.
 * Client service fee comes from `applyTaxiServiceFeeToQuote` (same as live quote).
 * Stripe fee is NOT part of the quote SoT — only an optional display estimate.
 */

export type TaxiQuoteRpcResult = {
  ok?: boolean;
  currency?: string;
  country_code?: string;
  vehicle_class?: string;
  subtotal_cents?: number;
  tax_cents?: number;
  platform_fee_cents?: number;
  driver_payout_cents?: number;
  total_cents?: number;
  distance_miles?: number;
  duration_minutes?: number;
  message?: string;
};

export type TaxiPricingPreviewBreakdown = {
  currency: string;
  country_code: string;
  vehicle_class: string;
  distance_miles: number;
  duration_minutes: number;
  /** Customer fare subtotal (includes booking fee; pre-tax, pre-service-fee). */
  customer_fare_cents: number;
  service_fee_cents: number;
  tax_cents: number;
  customer_total_cents: number;
  driver_earnings_cents: number;
  /** Platform share of subtotal from RPC. */
  platform_share_cents: number;
  /** Service fee accrues to platform (not driver). */
  mmd_platform_revenue_cents: number;
  /**
   * Display-only estimate (US card 2.9% + 30¢). Not used for settlement.
   * Actual fee = Stripe Balance Transaction after payment.
   */
  stripe_fee_estimate_cents: number;
  stripe_fee_is_estimate: true;
  mmd_net_estimate_cents: number;
  source: {
    fare_engine: "quote_taxi_ride";
    service_fee_engine: "applyTaxiServiceFeeToQuote";
    stripe_fee_engine: "display_estimate_only";
  };
};

/** Published US card rate — display estimate only, never for settlement. */
export function estimateStripeUsCardFeeCents(chargeCents: number): number {
  const amount = Math.max(0, Math.round(Number(chargeCents) || 0));
  if (amount <= 0) return 0;
  return Math.round(amount * 0.029 + 30);
}

export function buildTaxiPricingPreviewBreakdown(params: {
  quote: TaxiQuoteRpcResult;
  serviceFeeCents: number;
}): TaxiPricingPreviewBreakdown {
  const quote = params.quote;
  const customerFareCents = Math.max(0, Math.round(Number(quote.subtotal_cents ?? 0)));
  const taxCents = Math.max(0, Math.round(Number(quote.tax_cents ?? 0)));
  const serviceFeeCents = Math.max(0, Math.round(Number(params.serviceFeeCents ?? 0)));
  const driverEarningsCents = Math.max(
    0,
    Math.round(Number(quote.driver_payout_cents ?? 0))
  );
  const platformShareCents = Math.max(
    0,
    Math.round(Number(quote.platform_fee_cents ?? 0))
  );
  const customerTotalCents = customerFareCents + taxCents + serviceFeeCents;
  const mmdPlatformRevenueCents = platformShareCents + serviceFeeCents;
  const stripeFeeEstimateCents = estimateStripeUsCardFeeCents(customerTotalCents);

  return {
    currency: String(quote.currency ?? "USD").toUpperCase(),
    country_code: String(quote.country_code ?? "").toUpperCase(),
    vehicle_class: String(quote.vehicle_class ?? "").toLowerCase(),
    distance_miles: Number(quote.distance_miles ?? 0),
    duration_minutes: Number(quote.duration_minutes ?? 0),
    customer_fare_cents: customerFareCents,
    service_fee_cents: serviceFeeCents,
    tax_cents: taxCents,
    customer_total_cents: customerTotalCents,
    driver_earnings_cents: driverEarningsCents,
    platform_share_cents: platformShareCents,
    mmd_platform_revenue_cents: mmdPlatformRevenueCents,
    stripe_fee_estimate_cents: stripeFeeEstimateCents,
    stripe_fee_is_estimate: true,
    mmd_net_estimate_cents: mmdPlatformRevenueCents - stripeFeeEstimateCents,
    source: {
      fare_engine: "quote_taxi_ride",
      service_fee_engine: "applyTaxiServiceFeeToQuote",
      stripe_fee_engine: "display_estimate_only",
    },
  };
}

export function formatTaxiMoney(cents: number, currency: string): string {
  const amount = (Math.round(Number(cents) || 0) / 100).toFixed(2);
  return `${currency} ${amount}`;
}

/** Admin taxi ride detail — uses persisted ride snapshot (no recalculation). */
export function buildTaxiRideAdminFinancialBreakdown(
  ride: Record<string, unknown>,
) {
  const currency = String(ride.currency ?? "USD").toUpperCase();
  const subtotal = Math.max(0, Math.round(Number(ride.subtotal_cents ?? 0)));
  const tax = Math.max(0, Math.round(Number(ride.tax_cents ?? 0)));
  const serviceFee = Math.max(0, Math.round(Number(ride.service_fee_cents ?? 0)));
  const totalPaid = Math.max(0, Math.round(Number(ride.total_cents ?? 0)));
  const driver = Math.max(0, Math.round(Number(ride.driver_payout_cents ?? 0)));
  const platformShare = Math.max(
    0,
    Math.round(Number(ride.platform_fee_cents ?? 0)),
  );
  const tip = Math.max(0, Math.round(Number(ride.tip_cents ?? 0)));
  const discountTotal =
    Math.max(0, Math.round(Number(ride.discount_cents ?? 0))) +
    Math.max(0, Math.round(Number(ride.loyalty_discount_cents ?? 0))) +
    Math.max(0, Math.round(Number(ride.shared_discount_cents ?? 0))) +
    Math.max(0, Math.round(Number(ride.mmd_plus_discount_cents ?? 0))) +
    Math.max(0, Math.round(Number(ride.marketing_discount_cents ?? 0)));
  const mmdRevenue = platformShare + serviceFee;
  const stripeFeeEst = estimateStripeUsCardFeeCents(totalPaid);

  return {
    currency,
    customer_fare_cents: subtotal,
    tax_cents: tax,
    service_fee_cents: serviceFee,
    discount_total_cents: discountTotal,
    customer_total_cents: totalPaid,
    driver_earnings_cents: driver,
    platform_share_cents: platformShare,
    mmd_platform_revenue_cents: mmdRevenue,
    tip_cents: tip,
    tip_paid_out: ride.tip_paid_out === true,
    stripe_fee_estimate_cents: stripeFeeEst,
    stripe_fee_is_estimate: true as const,
    mmd_net_estimate_cents: mmdRevenue - stripeFeeEst,
    payment_status: String(ride.payment_status ?? ""),
    stripe_payment_intent_id: String(ride.stripe_payment_intent_id ?? "").trim() || null,
    settlement_frozen: String(ride.payment_status ?? "").toLowerCase() === "paid",
  };
}
