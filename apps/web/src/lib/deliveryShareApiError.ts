import {
  DELIVERY_SHARE_PCT_INVALID_CODE,
  DeliveryPricingConfigError,
} from "@/lib/deliveryPricing";
import { logTechnicalError } from "@/lib/userFacingError";

export function isDeliverySharePctError(error: unknown): boolean {
  if (error instanceof DeliveryPricingConfigError) {
    return error.code === DELIVERY_SHARE_PCT_INVALID_CODE;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    /driverSharePct\s*\+\s*platformSharePct/i.test(message) ||
    /must be provided together/i.test(message) ||
    /delivery share pair incomplete/i.test(message) ||
    message.includes(DELIVERY_SHARE_PCT_INVALID_CODE)
  );
}

/**
 * Returns a client-safe API payload for delivery share misconfiguration.
 * Technical detail is sent to Sentry — never expose variable names to mobile.
 */
export function deliverySharePctApiErrorPayload(scope: string, error: unknown) {
  logTechnicalError(scope, error, { code: DELIVERY_SHARE_PCT_INVALID_CODE });
  return {
    ok: false as const,
    error: DELIVERY_SHARE_PCT_INVALID_CODE,
    code: DELIVERY_SHARE_PCT_INVALID_CODE,
    message: DELIVERY_SHARE_PCT_INVALID_CODE,
  };
}
