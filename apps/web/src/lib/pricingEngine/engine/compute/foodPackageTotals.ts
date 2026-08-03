/**
 * Phase 5B — PE-owned Food/Package customer total assembly.
 */
import { dollarsToCents, roundMoney2 } from "./money";

export function assembleFoodPackageCustomerTotalCents(input: {
  subtotalAfterDiscount: number;
  tax: number;
  deliveryFee: number;
  serviceFee: number;
}): number {
  const total = roundMoney2(
    (Number(input.subtotalAfterDiscount) || 0) +
      (Number(input.tax) || 0) +
      (Number(input.deliveryFee) || 0) +
      (Number(input.serviceFee) || 0)
  );
  return Math.round(total * 100);
}

export function foodPackageFeeCents(deliveryFee: number, serviceFee: number): number {
  return dollarsToCents((Number(deliveryFee) || 0) + (Number(serviceFee) || 0));
}
