import { calculateCustomerDeliveryPrice } from "./calculateCustomerDeliveryPrice";
import { calculateDriverDeliveryEarning } from "./calculateDriverDeliveryEarning";
import { calculatePlatformMargin } from "./calculatePlatformMargin";
import type {
  DeliveryPricingV2EngineInput,
  DeliveryPricingV2EngineResult,
  ShadowCompareResult,
  V1PricingSnapshot,
} from "./types";

export function runDeliveryPricingV2Engine(
  input: DeliveryPricingV2EngineInput
): DeliveryPricingV2EngineResult {
  const customer = calculateCustomerDeliveryPrice({
    distanceMiles: input.distanceMiles,
    durationMinutes: input.durationMinutes,
    ...input.customer,
  });

  const driver = calculateDriverDeliveryEarning({
    distanceMiles: input.distanceMiles,
    durationMinutes: input.durationMinutes,
    ...input.driver,
  });

  const platform = calculatePlatformMargin(
    customer.totalCents,
    driver.earningCents
  );

  return { customer, driver, platform };
}

export function shadowCompareV1V2(
  v1: V1PricingSnapshot,
  v2Engine: DeliveryPricingV2EngineResult
): ShadowCompareResult {
  const v2 = {
    customerTotalCents: v2Engine.customer.totalCents,
    driverEarningCents: v2Engine.driver.earningCents,
    platformMarginCents: v2Engine.platform.marginCents,
  };

  return {
    v1,
    v2,
    diffCustomerCents: v2.customerTotalCents - v1.customerTotalCents,
    diffDriverCents: v2.driverEarningCents - v1.driverEarningCents,
    diffMarginCents: v2.platformMarginCents - v1.platformMarginCents,
  };
}
