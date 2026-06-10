export type DeliveryPricingShadowSourceType =
  | "delivery_request"
  | "food_order"
  | "marketplace_order_future";

export type CustomerDeliveryPriceInput = {
  distanceMiles: number;
  durationMinutes: number;
  baseFee?: number;
  perMinute?: number;
  perMile?: number;
  serviceFee?: number;
  /** Future surge / demand multiplier — defaults to 1 (no surge). */
  surgeMultiplier?: number;
  minTotal?: number;
};

export type CustomerDeliveryPriceResult = {
  totalCents: number;
  baseFeeCents: number;
  distanceComponentCents: number;
  timeComponentCents: number;
  serviceFeeCents: number;
  surgeMultiplier: number;
};

export type DriverDeliveryEarningInput = {
  distanceMiles: number;
  durationMinutes: number;
  /** 0–100 driver score; higher earns slightly more in shadow model. */
  driverScore?: number;
  /** 0–100 percentile ranking among active drivers. */
  driverRanking?: number;
  activeDriversInZone?: number;
  /** 0–1 normalized demand level in zone. */
  demandLevel?: number;
  pickupDistanceMiles?: number;
  basePerMile?: number;
  basePerMinute?: number;
  /** Future zone bonus multiplier — defaults to 1. */
  zoneBonusMultiplier?: number;
};

export type DriverDeliveryEarningResult = {
  earningCents: number;
  distanceComponentCents: number;
  timeComponentCents: number;
  scoreMultiplier: number;
  demandMultiplier: number;
  pickupAdjustmentCents: number;
  zoneBonusMultiplier: number;
};

export type PlatformMarginResult = {
  marginCents: number;
  customerTotalCents: number;
  driverEarningCents: number;
};

export type V1PricingSnapshot = {
  customerTotalCents: number;
  driverEarningCents: number;
  platformMarginCents: number;
};

export type V2PricingSnapshot = {
  customerTotalCents: number;
  driverEarningCents: number;
  platformMarginCents: number;
};

export type ShadowCompareResult = {
  v1: V1PricingSnapshot;
  v2: V2PricingSnapshot;
  diffCustomerCents: number;
  diffDriverCents: number;
  diffMarginCents: number;
};

export type DeliveryPricingV2EngineInput = {
  distanceMiles: number;
  durationMinutes: number;
  customer?: Partial<CustomerDeliveryPriceInput>;
  driver?: Partial<Omit<DriverDeliveryEarningInput, "distanceMiles" | "durationMinutes">>;
};

export type DeliveryPricingV2EngineResult = {
  customer: CustomerDeliveryPriceResult;
  driver: DriverDeliveryEarningResult;
  platform: PlatformMarginResult;
};

export type DeliveryPricingShadowLogInput = {
  sourceType: DeliveryPricingShadowSourceType;
  sourceId?: string | null;
  countryCode?: string | null;
  regionCode?: string | null;
  zoneCode?: string | null;
  v1CustomerTotalCents?: number;
  v1DriverEarningCents?: number;
  inputs: Record<string, unknown>;
};
