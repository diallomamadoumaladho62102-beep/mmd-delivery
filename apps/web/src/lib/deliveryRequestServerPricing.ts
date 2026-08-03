/**
 * Phase 6 — types only. Quote SoT: quotePackageSot / quotePackageWithPricingEngine.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryRequestPricingInput = {
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

export type DeliveryRequestPricingResult = {
  countryCode: string;
  currency: string;
  configKey: string;
  subtotal: number;
  tax: number;
  taxRatePct: number;
  taxSource: string;
  serviceFee: number;
  serviceFeeCents: number;
  serviceFeePct: number;
  serviceFeeEnabled: boolean;
  serviceFeeFixedCents: number;
  deliveryFeeRaw: number;
  deliveryFee: number;
  deliveryDiscountAmount: number;
  promoCodeApplied: string | null;
  promoDiscountAmount: number;
  discounts: number;
  subtotalAfterDiscount: number;
  marketingDiscountAmount: number;
  marketingDeliveryDiscountAmount: number;
  total: number;
  totalCents: number;
  distanceMiles: number;
  etaMinutes: number;
  driverPayoutEstimate: number;
};
