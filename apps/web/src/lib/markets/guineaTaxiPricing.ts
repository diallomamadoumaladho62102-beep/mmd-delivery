/**
 * Guinea taxi fare. Whole francs only. Rates come from configuration.
 * This module does not contain an official Orange or government tariff.
 */

export type GuineaTaxiRateCard = {
  baseFareGnf: number;
  perKmGnf: number;
  perMinuteGnf: number;
  minimumFareGnf: number;
  maximumFareGnf: number | null;
};

function readWholeGnf(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function readGuineaTaxiRateCard(
  env: Record<string, string | undefined> = process.env,
): { ok: true; card: GuineaTaxiRateCard } | { ok: false; error: "guinea_pricing_not_configured" } {
  const baseFareGnf = readWholeGnf(env.GUINEA_TAXI_BASE_FARE_GNF);
  const perKmGnf = readWholeGnf(env.GUINEA_TAXI_PER_KM_GNF);
  const perMinuteGnf = readWholeGnf(env.GUINEA_TAXI_PER_MINUTE_GNF);
  const minimumFareGnf = readWholeGnf(env.GUINEA_TAXI_MINIMUM_FARE_GNF);
  if (
    baseFareGnf == null ||
    perKmGnf == null ||
    perMinuteGnf == null ||
    minimumFareGnf == null
  ) {
    return { ok: false, error: "guinea_pricing_not_configured" };
  }

  const maximumRaw = String(env.GUINEA_TAXI_MAXIMUM_FARE_GNF ?? "").trim();
  let maximumFareGnf: number | null = null;
  if (maximumRaw) {
    maximumFareGnf = readWholeGnf(maximumRaw);
    if (maximumFareGnf == null) {
      return { ok: false, error: "guinea_pricing_not_configured" };
    }
  }

  return {
    ok: true,
    card: {
      baseFareGnf,
      perKmGnf,
      perMinuteGnf,
      minimumFareGnf,
      maximumFareGnf,
    },
  };
}

function mulDivRound(amount: number, numerator: number, denominator: number): number {
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    throw new Error("unsafe_integer");
  }
  const product = amount * numerator;
  if (!Number.isSafeInteger(product)) throw new Error("unsafe_integer");
  return Math.round(product / denominator);
}

export type GuineaFareQuote =
  | {
      ok: true;
      fareGnf: number;
      distanceMeters: number;
      durationMinutes: number;
    }
  | { ok: false; error: "invalid_route" | "fare_above_maximum" };

/**
 * fare = base + per_km * kilometers + per_minute * minutes,
 * then raised to the minimum. A configured maximum rejects the quote.
 * `distanceMeters` must already come from the road router.
 */
export function calculateGuineaTaxiFareGnf(input: {
  distanceMeters: number;
  durationMinutes: number;
  card: GuineaTaxiRateCard;
}): GuineaFareQuote {
  const distanceMeters = Math.round(Number(input.distanceMeters));
  const durationMinutes = Math.round(Number(input.durationMinutes));
  if (
    !Number.isSafeInteger(distanceMeters) ||
    distanceMeters <= 0 ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 0
  ) {
    return { ok: false, error: "invalid_route" };
  }
  const distanceComponent = mulDivRound(input.card.perKmGnf, distanceMeters, 1000);
  const timeComponent = input.card.perMinuteGnf * durationMinutes;
  if (!Number.isSafeInteger(timeComponent)) {
    return { ok: false, error: "invalid_route" };
  }
  let fareGnf = input.card.baseFareGnf + distanceComponent + timeComponent;
  if (fareGnf < input.card.minimumFareGnf) fareGnf = input.card.minimumFareGnf;
  if (!Number.isSafeInteger(fareGnf) || fareGnf <= 0) {
    return { ok: false, error: "invalid_route" };
  }
  if (input.card.maximumFareGnf != null && fareGnf > input.card.maximumFareGnf) {
    return { ok: false, error: "fare_above_maximum" };
  }
  return { ok: true, fareGnf, distanceMeters, durationMinutes };
}

export function milesToWholeMeters(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  return Math.round(miles * 1609.344);
}

/** Display whole francs. Example: 85 000 GNF. */
export function formatGuineaFare(amountGnf: number): string {
  const amount = Math.round(Number(amountGnf));
  if (!Number.isFinite(amount)) return "0 GNF";
  const formatted = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(amount);
  return `${formatted} GNF`;
}

export function minorUnitsToMajor(amountMinor: number, currency: string): number {
  const code = String(currency || "USD").trim().toUpperCase();
  if (code === "GNF") return amountMinor;
  return amountMinor / 100;
}
