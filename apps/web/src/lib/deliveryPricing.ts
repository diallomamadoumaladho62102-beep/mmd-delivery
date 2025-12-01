export type DeliveryPricingResult = {
  deliveryFee: number;      // ce que le client paie pour la livraison
  platformFee: number;      // part MMD Delivery
  driverPayout: number;     // ce qui revient au chauffeur
};

type Params = {
  distanceMiles: number;
  durationMinutes: number;
};

// Fonction d'arrondi propre
export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * 🚀 FORMULE OFFICIELLE MMD DELIVERY (style Uber / DoorDash)
 *
 * BASE = 2.50$
 * PER_MILE = 0.90$
 * PER_MINUTE = 0.15$
 * MINIMUM = 3.49$
 *
 * Split : 80% chauffeur / 20% plateforme
 */
export function computeDeliveryPricing({
  distanceMiles,
  durationMinutes,
}: Params): DeliveryPricingResult {
  const BASE_FARE = 2.5;
  const PER_MILE = 0.9;
  const PER_MINUTE = 0.15;
  const MIN_FARE = 3.49;

  // 🔢 Calcul brut (non arrondi)
  const raw =
    BASE_FARE +
    distanceMiles * PER_MILE +
    durationMinutes * PER_MINUTE;

  // 💰 Appliquer minimum garanti
  const deliveryFee = round2(Math.max(MIN_FARE, raw));

  // 🔥 Split chauffeur / plateforme
  const platformFee = round2(deliveryFee * 0.20); // 20%
  const driverPayout = round2(deliveryFee * 0.80); // 80%

  return {
    deliveryFee,
    platformFee,
    driverPayout,
  };
}

// 💰 Fonction utilitaire pour calculer 80% du prix livraison
export function computeDriverPay(deliveryFee: number) {
  return round2(deliveryFee * 0.80);
}

// 💼 Fonction utilitaire pour calculer 20% plateforme
export function computePlatformCommission(deliveryFee: number) {
  return round2(deliveryFee * 0.20);
}
