/**
 * Phase 5B — PE-owned money helpers (parity with legacy round2 / cents).
 * No imports from @/lib/deliveryPricing or foodOrderServerPricing.
 */

export function roundMoney2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("roundMoney2 received a non-finite number.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function dollarsToCents(value: number): number {
  return Math.round(roundMoney2(Number(value) || 0) * 100);
}

export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
