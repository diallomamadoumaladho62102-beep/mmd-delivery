/**
 * Phase 5F — PE-owned discount stacking (pure clamps).
 */
import { roundMoney2 } from "./money";

export function applyOrderAndDeliveryDiscounts(input: {
  subtotal: number;
  deliveryFee: number;
  orderDiscount: number;
  deliveryDiscount: number;
}): { subtotalAfterDiscount: number; deliveryFeeAfterDiscount: number } {
  return {
    subtotalAfterDiscount: roundMoney2(
      Math.max(0, Number(input.subtotal) - Number(input.orderDiscount || 0))
    ),
    deliveryFeeAfterDiscount: roundMoney2(
      Math.max(0, Number(input.deliveryFee) - Number(input.deliveryDiscount || 0))
    ),
  };
}

export function sumDiscountDollars(...parts: number[]): number {
  return roundMoney2(
    parts.reduce((sum, p) => sum + (Number.isFinite(p) ? Math.max(0, p) : 0), 0)
  );
}
