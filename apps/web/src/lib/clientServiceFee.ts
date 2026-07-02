export type ServiceFeeConfig = {
  enabled: boolean;
  pct: number;
  fixedCents: number;
};

export type ServiceFeeResult = {
  enabled: boolean;
  pct: number;
  fixedCents: number;
  baseAmount: number;
  serviceFee: number;
  serviceFeeCents: number;
};

export const FORBIDDEN_CLIENT_SERVICE_FEE_FIELDS = [
  "service_fee",
  "service_fee_cents",
  "service_fee_pct",
  "service_fee_enabled",
  "service_fee_fixed_cents",
] as const;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function parseServiceFeeConfig(row: {
  service_fee_enabled?: boolean | null;
  service_fee_pct?: number | null;
  service_fee_fixed_cents?: number | null;
  client_pct?: number | null;
  fixed_client_fee?: number | null;
} | null | undefined): ServiceFeeConfig {
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

export function computeServiceFeeBaseAmount(input: {
  subtotalAfterDiscount: number;
  deliveryFeeAfterDiscount?: number;
}): number {
  const subtotal = roundMoney(Math.max(Number(input.subtotalAfterDiscount ?? 0), 0));
  if (subtotal > 0) return subtotal;

  const deliveryFee = roundMoney(Math.max(Number(input.deliveryFeeAfterDiscount ?? 0), 0));
  return deliveryFee;
}

export function computeClientServiceFee(
  config: ServiceFeeConfig,
  baseAmountDollars: number
): ServiceFeeResult {
  const baseAmount = roundMoney(Math.max(Number(baseAmountDollars ?? 0), 0));
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
    serviceFee: roundMoney(serviceFeeCents / 100),
    serviceFeeCents,
  };
}

export function computeClientServiceFeeFromCentsBase(
  config: ServiceFeeConfig,
  baseAmountCents: number
): ServiceFeeResult {
  return computeClientServiceFee(config, roundMoney(baseAmountCents / 100));
}

export function assertNoClientServiceFeeFields(body: Record<string, unknown>) {
  for (const key of FORBIDDEN_CLIENT_SERVICE_FEE_FIELDS) {
    if (body[key] !== undefined && body[key] !== null) {
      throw new Error(`Client-provided service fee field rejected: ${key}`);
    }
  }
}
