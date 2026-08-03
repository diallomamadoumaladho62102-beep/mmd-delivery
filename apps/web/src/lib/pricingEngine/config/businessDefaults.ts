/**
 * Phase 1 — Pricing business defaults (parity with pre-Phase-1 hardcodes).
 *
 * ADR-001 FINAL: these values ARE the configuration source for runtime until
 * Admin/DB overrides are explicitly enabled. Changing a number here changes
 * production behavior — treat as config, not formula.
 *
 * Seed mirror: supabase/migrations/20261101120000_pricing_business_defaults.sql
 */

export const PRICING_BUSINESS_DEFAULTS = {
  // Delivery V1 (food / package)
  delivery_base_fare: 2.5,
  delivery_per_mile: 0.9,
  delivery_per_minute: 0.15,
  delivery_min_fare: 3.49,
  delivery_driver_share_pct: 80,
  delivery_platform_share_pct: 20,
  delivery_fee_abnormal_multiplier: 8,
  delivery_fee_abnormal_absolute_usd: 40,

  // Delivery V2 shadow — customer
  delivery_v2_base_fee: 2.5,
  delivery_v2_per_mile: 0.9,
  delivery_v2_per_minute: 0.15,
  delivery_v2_service_fee: 0.99,
  delivery_v2_surge_multiplier: 1,
  delivery_v2_min_total: 3.49,

  // Delivery V2 shadow — driver earning
  delivery_v2_driver_per_mile: 0.72,
  delivery_v2_driver_per_minute: 0.12,
  delivery_v2_pickup_per_mile: 0.05,
  delivery_v2_pickup_cap: 0.75,

  // Marketplace checkout delivery fee (shadow / charged path today)
  marketplace_delivery_fee_floor_cents: 299,
  marketplace_delivery_fee_pct: 0.08,

  // Food tax legacy fallback (US) when taxi_country_taxes has no food row
  food_legacy_tax_rate: 0.0888,

  // Taxi shared ride
  taxi_shared_ride_discount_percent: 15,
  taxi_shared_ride_match_window_minutes: 15,

  // Taxi quote drift guard
  taxi_quote_drift_tolerance_cents: 50,
  taxi_quote_drift_tolerance_ratio: 0.02,

  // Wait fees
  wait_timer_free_minutes: 5,
  wait_fee_tier1_rate_cents: 25,
  wait_fee_tier1_minutes: 3,
  wait_fee_tier2_rate_cents: 30,
  wait_fee_tier2_minutes: 5,
  wait_fee_max_cents: 225,
  driver_arrival_max_meters: 50,
  driver_arrival_manual_review_meters: 150,

  // Taxi no-show compensation (% of ride price)
  taxi_no_show_compensation_pct: 0.05,

  // Tips / credit / cashout thresholds
  taxi_tip_min_cents: 50,
  mmd_credit_min_residual_cents: 50,
  driver_cashout_minimum_cents: 2000,
  driver_cashout_cooldown_ms: 24 * 60 * 60 * 1000,
} as const;

export type PricingBusinessDefaultKey = keyof typeof PRICING_BUSINESS_DEFAULTS;

export type PricingBusinessDefaults = {
  -readonly [K in PricingBusinessDefaultKey]: number;
};

/** Frozen copy used as runtime SoT (Phase 1). */
export function getPricingBusinessDefaults(): PricingBusinessDefaults {
  return { ...PRICING_BUSINESS_DEFAULTS };
}

export function getPricingBusinessDefault(
  key: PricingBusinessDefaultKey
): number {
  return PRICING_BUSINESS_DEFAULTS[key];
}
