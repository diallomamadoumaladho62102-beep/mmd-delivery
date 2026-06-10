import type { PlatformMarginResult } from "./types";

export function calculatePlatformMargin(
  customerTotalCents: number,
  driverEarningCents: number
): PlatformMarginResult {
  if (!Number.isFinite(customerTotalCents) || customerTotalCents < 0) {
    throw new Error("customerTotalCents must be a finite number >= 0");
  }
  if (!Number.isFinite(driverEarningCents) || driverEarningCents < 0) {
    throw new Error("driverEarningCents must be a finite number >= 0");
  }

  return {
    customerTotalCents: Math.round(customerTotalCents),
    driverEarningCents: Math.round(driverEarningCents),
    marginCents: Math.round(customerTotalCents - driverEarningCents),
  };
}
