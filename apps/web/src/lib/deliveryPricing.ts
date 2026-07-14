export type DeliveryPricingResult = {
  deliveryFee: number; // ce que le client paie pour la livraison
  platformFee: number; // part MMD Delivery
  driverPayout: number; // ce qui revient au chauffeur
};

export type DeliveryPricingParams = {
  distanceMiles: number;
  durationMinutes: number;
};

export type DeliveryPricingConfig = {
  baseFare?: number;
  perMile?: number;
  perMinute?: number;
  minFare?: number;
  driverSharePct?: number; // ex: 80 (0–100 scale)
  platformSharePct?: number; // ex: 20 (0–100 scale)
};

export const DELIVERY_SHARE_PCT_INVALID_CODE = "delivery_share_pct_invalid";
export const DELIVERY_FEE_ABNORMAL_CODE = "delivery_fee_abnormal";

export class DeliveryPricingConfigError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DeliveryPricingConfigError";
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_DELIVERY_PRICING_CONFIG: Required<DeliveryPricingConfig> = {
  baseFare: 2.5,
  perMile: 0.9,
  perMinute: 0.15,
  minFare: 3.49,
  driverSharePct: 80,
  platformSharePct: 20,
};

/** Soft ceiling: fees above this vs computed raw fare or absolute level need audit. */
export const DELIVERY_FEE_ABNORMAL_MULTIPLIER = 8;
export const DELIVERY_FEE_ABNORMAL_ABSOLUTE_USD = 40;

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new DeliveryPricingConfigError(
      "delivery_pricing_invalid_number",
      `${field} must be a finite number.`,
      { field, value }
    );
  }

  if (value < 0) {
    throw new DeliveryPricingConfigError(
      "delivery_pricing_invalid_number",
      `${field} must be greater than or equal to 0.`,
      { field, value }
    );
  }
}

/**
 * Convert legacy 0–1 fractions to 0–100 percentages.
 * Values already on 0–100 stay unchanged. Nullish → null.
 */
export function normalizeSharePctScale(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  // Treat values in (0, 1] as fractions (0.8 → 80), keep 0 and >1 as-is.
  if (num > 0 && num <= 1) {
    return round2(num * 100);
  }
  return round2(num);
}

function assertPercentage(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new DeliveryPricingConfigError(
      DELIVERY_SHARE_PCT_INVALID_CODE,
      `${field} must be a finite number.`,
      { field, value }
    );
  }

  if (value < 0 || value > 100) {
    throw new DeliveryPricingConfigError(
      DELIVERY_SHARE_PCT_INVALID_CODE,
      `${field} must be between 0 and 100.`,
      { field, value }
    );
  }
}

// Fonction d'arrondi monétaire propre
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("round2 received a non-finite number.");
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Validate delivery fee share percentages (driver + platform).
 * Does NOT include restaurant/vendor commission — that is a separate base.
 */
export function assertDeliverySharePctValid(
  driverSharePct: number,
  platformSharePct: number
): void {
  assertPercentage(driverSharePct, "driverSharePct");
  assertPercentage(platformSharePct, "platformSharePct");

  const totalShare = round2(driverSharePct + platformSharePct);

  if (totalShare > 100) {
    throw new DeliveryPricingConfigError(
      DELIVERY_SHARE_PCT_INVALID_CODE,
      "driverSharePct + platformSharePct must be <= 100.",
      {
        driverSharePct,
        platformSharePct,
        totalShare,
      }
    );
  }
}

/**
 * Build a normalized delivery pricing config.
 *
 * Critical merge rules:
 * - Percentages on 0–1 scale are converted to 0–100.
 * - If only one of driver/platform share is provided, the other is derived
 *   as 100 − provided (instead of silently keeping the unrelated default 80/20).
 * - Restaurant/vendor % must never be mixed into this pair.
 */
export function normalizeDeliveryPricingConfig(
  config?: DeliveryPricingConfig
): Required<DeliveryPricingConfig> {
  const driverProvided = config?.driverSharePct != null;
  const platformProvided = config?.platformSharePct != null;

  const scaledDriver = normalizeSharePctScale(config?.driverSharePct);
  const scaledPlatform = normalizeSharePctScale(config?.platformSharePct);

  let driverSharePct = scaledDriver ?? DEFAULT_DELIVERY_PRICING_CONFIG.driverSharePct;
  let platformSharePct =
    scaledPlatform ?? DEFAULT_DELIVERY_PRICING_CONFIG.platformSharePct;

  if (platformProvided && !driverProvided && scaledPlatform != null) {
    driverSharePct = round2(Math.max(0, 100 - scaledPlatform));
  } else if (driverProvided && !platformProvided && scaledDriver != null) {
    platformSharePct = round2(Math.max(0, 100 - scaledDriver));
  } else if (!driverProvided && !platformProvided) {
    driverSharePct = DEFAULT_DELIVERY_PRICING_CONFIG.driverSharePct;
    platformSharePct = DEFAULT_DELIVERY_PRICING_CONFIG.platformSharePct;
  }

  const merged: Required<DeliveryPricingConfig> = {
    baseFare:
      config?.baseFare != null && Number.isFinite(Number(config.baseFare))
        ? Number(config.baseFare)
        : DEFAULT_DELIVERY_PRICING_CONFIG.baseFare,
    perMile:
      config?.perMile != null && Number.isFinite(Number(config.perMile))
        ? Number(config.perMile)
        : DEFAULT_DELIVERY_PRICING_CONFIG.perMile,
    perMinute:
      config?.perMinute != null && Number.isFinite(Number(config.perMinute))
        ? Number(config.perMinute)
        : DEFAULT_DELIVERY_PRICING_CONFIG.perMinute,
    minFare:
      config?.minFare != null && Number.isFinite(Number(config.minFare))
        ? Number(config.minFare)
        : DEFAULT_DELIVERY_PRICING_CONFIG.minFare,
    driverSharePct,
    platformSharePct,
  };

  assertFiniteNonNegative(merged.baseFare, "baseFare");
  assertFiniteNonNegative(merged.perMile, "perMile");
  assertFiniteNonNegative(merged.perMinute, "perMinute");
  assertFiniteNonNegative(merged.minFare, "minFare");

  assertDeliverySharePctValid(merged.driverSharePct, merged.platformSharePct);

  return merged;
}

/**
 * Detect abnormally high delivery fees (distance/unit misconfig, not share %).
 * Returns a structured flag for logging / tests — does not block pricing itself.
 */
export function evaluateDeliveryFeeAbnormality(
  deliveryFee: number,
  params: DeliveryPricingParams,
  config?: DeliveryPricingConfig
): {
  abnormal: boolean;
  reason: string | null;
  details: Record<string, unknown>;
} {
  const normalized = normalizeDeliveryPricingConfig(config);
  const expectedRaw = round2(
    normalized.baseFare +
      params.distanceMiles * normalized.perMile +
      params.durationMinutes * normalized.perMinute
  );
  const expected = round2(Math.max(normalized.minFare, expectedRaw));

  if (Math.abs(deliveryFee - expected) > 0.05) {
    return {
      abnormal: true,
      reason: "fee_mismatch_vs_engine",
      details: {
        deliveryFee,
        expected,
        distanceMiles: params.distanceMiles,
        durationMinutes: params.durationMinutes,
      },
    };
  }

  // Short trip + very high absolute fee strongly suggests km/m unit confusion
  // (e.g. feeding meters as miles) or misconfigured Admin rates.
  const shortTrip = params.distanceMiles < 2 && params.durationMinutes < 15;
  const highAbsolute = deliveryFee >= DELIVERY_FEE_ABNORMAL_ABSOLUTE_USD;
  const highVsFloor =
    deliveryFee >=
    Math.max(normalized.baseFare, normalized.minFare, 1) *
      DELIVERY_FEE_ABNORMAL_MULTIPLIER;

  if (shortTrip && highAbsolute && highVsFloor) {
    return {
      abnormal: true,
      reason: "short_trip_high_fee",
      details: {
        deliveryFee,
        distanceMiles: params.distanceMiles,
        durationMinutes: params.durationMinutes,
        baseFare: normalized.baseFare,
        perMile: normalized.perMile,
        perMinute: normalized.perMinute,
      },
    };
  }

  return { abnormal: false, reason: null, details: { deliveryFee, expected } };
}

export function assertDeliveryFeeNotAbnormal(
  deliveryFee: number,
  params: DeliveryPricingParams,
  config?: DeliveryPricingConfig
): void {
  const result = evaluateDeliveryFeeAbnormality(deliveryFee, params, config);
  if (result.abnormal) {
    throw new DeliveryPricingConfigError(
      DELIVERY_FEE_ABNORMAL_CODE,
      `deliveryFee ${deliveryFee} is abnormally high (${result.reason}).`,
      result.details
    );
  }
}

/**
 * Explain a delivery fee for audits (e.g. 25.44 USD on a 7.66 cart).
 */
export function explainDeliveryFee(
  params: DeliveryPricingParams,
  config?: DeliveryPricingConfig
): {
  distanceMiles: number;
  durationMinutes: number;
  rawFare: number;
  deliveryFee: number;
  formula: string;
  note: string;
} {
  const normalized = normalizeDeliveryPricingConfig(config);
  const rawFare = round2(
    normalized.baseFare +
      params.distanceMiles * normalized.perMile +
      params.durationMinutes * normalized.perMinute
  );
  const deliveryFee = round2(Math.max(normalized.minFare, rawFare));

  return {
    distanceMiles: params.distanceMiles,
    durationMinutes: params.durationMinutes,
    rawFare,
    deliveryFee,
    formula: `${normalized.baseFare} + ${params.distanceMiles}*${normalized.perMile} + ${params.durationMinutes}*${normalized.perMinute}`,
    note:
      "Delivery fee is distance/time based (miles + minutes), independent of food subtotal. Mapbox meters are converted with /1609.34.",
  };
}

/**
 * 🚀 MMD DELIVERY PRICING ENGINE
 *
 * Par défaut :
 * - baseFare = 2.50
 * - perMile = 0.90
 * - perMinute = 0.15
 * - minFare = 3.49
 * - driverSharePct = 80
 * - platformSharePct = 20
 *
 * Peut être surchargé via config.
 *
 * Règle critique production :
 * platformFee + driverPayout = deliveryFee
 * (driver share is the residual after platformSharePct, consistent with admin 80/20)
 */
export function computeDeliveryPricing(
  { distanceMiles, durationMinutes }: DeliveryPricingParams,
  config?: DeliveryPricingConfig
): DeliveryPricingResult {
  assertFiniteNonNegative(distanceMiles, "distanceMiles");
  assertFiniteNonNegative(durationMinutes, "durationMinutes");

  const normalizedConfig = normalizeDeliveryPricingConfig(config);

  const rawFare =
    normalizedConfig.baseFare +
    distanceMiles * normalizedConfig.perMile +
    durationMinutes * normalizedConfig.perMinute;

  const deliveryFee = round2(Math.max(normalizedConfig.minFare, rawFare));

  const platformFee = round2(
    deliveryFee * (normalizedConfig.platformSharePct / 100)
  );

  // Prefer residual so platformFee + driverPayout always equals deliveryFee.
  // When shares sum to 100 this matches driverSharePct; when under 100 the
  // residual (including unallocated %) goes to the driver — never to vendor %.
  const driverPayout = round2(deliveryFee - platformFee);

  return {
    deliveryFee,
    platformFee,
    driverPayout,
  };
}

// 💰 Fonction utilitaire chauffeur
export function computeDriverPay(
  deliveryFee: number,
  config?: Pick<DeliveryPricingConfig, "platformSharePct" | "driverSharePct">
): number {
  assertFiniteNonNegative(deliveryFee, "deliveryFee");

  const normalizedFee = round2(deliveryFee);
  const normalizedConfig = normalizeDeliveryPricingConfig({
    platformSharePct: config?.platformSharePct,
    driverSharePct: config?.driverSharePct,
  });

  const platformFee = round2(
    normalizedFee * (normalizedConfig.platformSharePct / 100)
  );

  return round2(normalizedFee - platformFee);
}

// 💼 Fonction utilitaire plateforme
export function computePlatformCommission(
  deliveryFee: number,
  config?: Pick<DeliveryPricingConfig, "platformSharePct" | "driverSharePct">
): number {
  assertFiniteNonNegative(deliveryFee, "deliveryFee");

  const normalizedFee = round2(deliveryFee);
  const normalizedConfig = normalizeDeliveryPricingConfig({
    platformSharePct: config?.platformSharePct,
    driverSharePct: config?.driverSharePct,
  });

  return round2(
    normalizedFee * (normalizedConfig.platformSharePct / 100)
  );
}

/**
 * Assert quote total matches Stripe / order amount (cents).
 */
export function assertQuoteMatchesStripeAmount(params: {
  quoteTotal: number;
  stripeAmountCents: number;
  orderTotalCents?: number | null;
  toleranceCents?: number;
}): void {
  const tolerance = params.toleranceCents ?? 1;
  const quoteCents = Math.round(round2(params.quoteTotal) * 100);

  if (Math.abs(quoteCents - params.stripeAmountCents) > tolerance) {
    throw new DeliveryPricingConfigError(
      "quote_stripe_mismatch",
      `Quote total ${quoteCents} cents does not match Stripe amount ${params.stripeAmountCents}.`,
      {
        quoteCents,
        stripeAmountCents: params.stripeAmountCents,
        orderTotalCents: params.orderTotalCents ?? null,
      }
    );
  }

  if (
    params.orderTotalCents != null &&
    Math.abs(quoteCents - params.orderTotalCents) > tolerance
  ) {
    throw new DeliveryPricingConfigError(
      "quote_order_mismatch",
      `Quote total ${quoteCents} cents does not match order total ${params.orderTotalCents}.`,
      {
        quoteCents,
        orderTotalCents: params.orderTotalCents,
        stripeAmountCents: params.stripeAmountCents,
      }
    );
  }
}

export { DEFAULT_DELIVERY_PRICING_CONFIG };
