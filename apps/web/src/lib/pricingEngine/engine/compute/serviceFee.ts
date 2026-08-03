/**
 * Phase 5F — PE-owned client service fee (pure).
 * Mirrored from legacy clientServiceFee.ts — legacy file retained for Kill Switch.
 */
import { roundCents, roundMoney2 } from "./money";

export type PeServiceFeeConfig = {
  enabled: boolean;
  pct: number;
  fixedCents: number;
};

export type PeServiceFeeResult = {
  enabled: boolean;
  pct: number;
  fixedCents: number;
  baseAmount: number;
  serviceFee: number;
  serviceFeeCents: number;
};

export function parsePeServiceFeeConfig(row: {
  service_fee_enabled?: boolean | null;
  service_fee_pct?: number | null;
  service_fee_fixed_cents?: number | null;
  client_pct?: number | null;
  fixed_client_fee?: number | null;
} | null | undefined): PeServiceFeeConfig {
  if (!row) {
    return { enabled: false, pct: 0, fixedCents: 0 };
  }
  const pct = Number(row.service_fee_pct ?? row.client_pct ?? 0);
  const fixedFromCents = Number(row.service_fee_fixed_cents ?? 0);
  const fixedFromLegacy = Number(row.fixed_client_fee ?? 0);
  return {
    enabled: row.service_fee_enabled === true,
    pct: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0,
    fixedCents:
      fixedFromCents > 0
        ? roundCents(fixedFromCents)
        : fixedFromLegacy > 0
          ? roundCents(fixedFromLegacy * 100)
          : 0,
  };
}

export function computePeServiceFeeBaseAmount(input: {
  subtotalAfterDiscount: number;
  deliveryFeeAfterDiscount?: number;
}): number {
  const subtotal = roundMoney2(Math.max(Number(input.subtotalAfterDiscount ?? 0), 0));
  if (subtotal > 0) return subtotal;
  return roundMoney2(Math.max(Number(input.deliveryFeeAfterDiscount ?? 0), 0));
}

export function computePeClientServiceFee(
  config: PeServiceFeeConfig,
  baseAmountDollars: number
): PeServiceFeeResult {
  const baseAmount = roundMoney2(Math.max(Number(baseAmountDollars ?? 0), 0));
  const pct = Number.isFinite(config.pct) ? Math.max(0, Math.min(100, config.pct)) : 0;
  const fixedCents = roundCents(config.fixedCents);

  if (!config.enabled || baseAmount <= 0) {
    return {
      enabled: false,
      pct,
      fixedCents,
      baseAmount,
      serviceFee: 0,
      serviceFeeCents: 0,
    };
  }

  const pctFeeCents = roundCents(baseAmount * 100 * (pct / 100));
  const serviceFeeCents =
    fixedCents > 0 ? Math.max(fixedCents, pctFeeCents) : pctFeeCents;

  return {
    enabled: true,
    pct,
    fixedCents,
    baseAmount,
    serviceFee: roundMoney2(serviceFeeCents / 100),
    serviceFeeCents,
  };
}

export function computePeClientServiceFeeFromCentsBase(
  config: PeServiceFeeConfig,
  baseAmountCents: number
): PeServiceFeeResult {
  return computePeClientServiceFee(config, roundMoney2(baseAmountCents / 100));
}
