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
  driverSharePct?: number; // ex: 80
  platformSharePct?: number; // ex: 20
};

const DEFAULT_DELIVERY_PRICING_CONFIG: Required<DeliveryPricingConfig> = {
  baseFare: 2.5,
  perMile: 0.9,
  perMinute: 0.15,
  minFare: 3.49,
  driverSharePct: 80,
  platformSharePct: 20,
};

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }

  if (value < 0) {
    throw new Error(`${field} must be greater than or equal to 0.`);
  }
}

function assertPercentage(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }

  if (value < 0 || value > 100) {
    throw new Error(`${field} must be between 0 and 100.`);
  }
}

// Fonction d'arrondi monétaire propre
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("round2 received a non-finite number.");
  }

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeDeliveryPricingConfig(
  config?: DeliveryPricingConfig
): Required<DeliveryPricingConfig> {
  const merged: Required<DeliveryPricingConfig> = {
    ...DEFAULT_DELIVERY_PRICING_CONFIG,
    ...(config ?? {}),
  };

  assertFiniteNonNegative(merged.baseFare, "baseFare");
  assertFiniteNonNegative(merged.perMile, "perMile");
  assertFiniteNonNegative(merged.perMinute, "perMinute");
  assertFiniteNonNegative(merged.minFare, "minFare");

  assertPercentage(merged.driverSharePct, "driverSharePct");
  assertPercentage(merged.platformSharePct, "platformSharePct");

  const totalShare = round2(merged.driverSharePct + merged.platformSharePct);

  if (totalShare > 100) {
    throw new Error("driverSharePct + platformSharePct must be <= 100.");
  }

  return merged;
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
  config?: Pick<DeliveryPricingConfig, "platformSharePct">
): number {
  assertFiniteNonNegative(deliveryFee, "deliveryFee");

  const normalizedFee = round2(deliveryFee);
  const normalizedConfig = normalizeDeliveryPricingConfig({
    platformSharePct: config?.platformSharePct,
  });

  const platformFee = round2(
    normalizedFee * (normalizedConfig.platformSharePct / 100)
  );

  return round2(normalizedFee - platformFee);
}

// 💼 Fonction utilitaire plateforme
export function computePlatformCommission(
  deliveryFee: number,
  config?: Pick<DeliveryPricingConfig, "platformSharePct">
): number {
  assertFiniteNonNegative(deliveryFee, "deliveryFee");

  const normalizedFee = round2(deliveryFee);
  const normalizedConfig = normalizeDeliveryPricingConfig({
    platformSharePct: config?.platformSharePct,
  });

  return round2(
    normalizedFee * (normalizedConfig.platformSharePct / 100)
  );
}

export { DEFAULT_DELIVERY_PRICING_CONFIG };