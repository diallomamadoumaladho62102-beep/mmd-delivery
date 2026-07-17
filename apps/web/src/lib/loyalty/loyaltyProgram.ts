/**
 * Pure, framework-agnostic loyalty logic shared by API routes and (mirrored by)
 * the mobile app. No I/O here — everything is deterministic and unit-tested.
 * The authoritative mutations happen in the database RPCs; these helpers only
 * compute derived values for display and request validation.
 */

export type LoyaltyTierConfig = {
  code: string;
  label: string;
  minLifetimePoints: number;
};

export type LoyaltySettings = {
  enabled: boolean;
  pointsPerDelivery: number;
  pointsPerRide: number;
  conversionPoints: number;
  conversionCreditCents: number;
  creditValidityMonths: 0 | 6 | 12;
  referralPointsClient: number;
  referralPointsDriver: number;
  currency: string;
};

export const DEFAULT_LOYALTY_TIERS: LoyaltyTierConfig[] = [
  { code: "bronze", label: "Bronze", minLifetimePoints: 0 },
  { code: "silver", label: "Silver", minLifetimePoints: 100 },
  { code: "gold", label: "Gold", minLifetimePoints: 500 },
  { code: "platinum", label: "Platinum", minLifetimePoints: 1500 },
];

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: true,
  pointsPerDelivery: 1,
  pointsPerRide: 1,
  conversionPoints: 100,
  conversionCreditCents: 500,
  creditValidityMonths: 0,
  referralPointsClient: 10,
  referralPointsDriver: 10,
  currency: "USD",
};

function safeInt(value: unknown, fallback = 0): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the tier for a given lifetime points total. Returns the highest tier
 * whose threshold is met. Falls back to the lowest tier (or "bronze").
 */
export function resolveTier(
  lifetimePoints: number,
  tiers: LoyaltyTierConfig[] = DEFAULT_LOYALTY_TIERS
): LoyaltyTierConfig {
  const lifetime = Math.max(0, safeInt(lifetimePoints));
  const sorted = [...tiers]
    .filter((t) => Number.isFinite(t.minLifetimePoints))
    .sort((a, b) => a.minLifetimePoints - b.minLifetimePoints);

  if (sorted.length === 0) {
    return { code: "bronze", label: "Bronze", minLifetimePoints: 0 };
  }

  let current = sorted[0];
  for (const tier of sorted) {
    if (lifetime >= tier.minLifetimePoints) {
      current = tier;
    } else {
      break;
    }
  }
  return current;
}

/** The next tier above the current one, or null if already at the top. */
export function nextTier(
  lifetimePoints: number,
  tiers: LoyaltyTierConfig[] = DEFAULT_LOYALTY_TIERS
): LoyaltyTierConfig | null {
  const lifetime = Math.max(0, safeInt(lifetimePoints));
  const sorted = [...tiers].sort(
    (a, b) => a.minLifetimePoints - b.minLifetimePoints
  );
  return sorted.find((t) => t.minLifetimePoints > lifetime) ?? null;
}

/** How many whole conversion blocks a balance can afford. */
export function convertibleBlocks(
  pointsBalance: number,
  conversionPoints: number
): number {
  const balance = Math.max(0, safeInt(pointsBalance));
  const per = safeInt(conversionPoints);
  if (per <= 0) return 0;
  return Math.floor(balance / per);
}

/** Whether the balance is enough to convert at least one block. */
export function canConvert(
  pointsBalance: number,
  conversionPoints: number
): boolean {
  return convertibleBlocks(pointsBalance, conversionPoints) >= 1;
}

/** Credit (in cents) produced by converting a number of blocks. */
export function creditCentsForBlocks(
  blocks: number,
  conversionCreditCents: number
): number {
  const b = Math.max(0, safeInt(blocks));
  const perBlock = Math.max(0, safeInt(conversionCreditCents));
  return b * perBlock;
}

/**
 * Validate & clamp a requested block count against what the balance affords.
 * Returns 0 when the request is invalid or unaffordable.
 */
export function resolveConversionBlocks(
  requestedBlocks: number,
  pointsBalance: number,
  conversionPoints: number
): number {
  const requested = safeInt(requestedBlocks, 0);
  if (requested < 1) return 0;
  const affordable = convertibleBlocks(pointsBalance, conversionPoints);
  return Math.min(requested, affordable);
}

/** Format cents into a human string, e.g. 500 -> "5.00 USD". */
export function formatCredit(cents: number, currency = "USD"): string {
  const value = Math.max(0, safeInt(cents)) / 100;
  return `${value.toFixed(2)} ${currency}`;
}

/**
 * Normalize a raw settings row (snake_case from Supabase) into typed settings,
 * falling back to defaults for any missing/invalid field.
 */
export function parseLoyaltySettings(
  row: Record<string, unknown> | null | undefined
): LoyaltySettings {
  if (!row) return { ...DEFAULT_LOYALTY_SETTINGS };
  const validity = safeInt(
    row.credit_validity_months,
    DEFAULT_LOYALTY_SETTINGS.creditValidityMonths
  );
  const creditValidityMonths: 0 | 6 | 12 =
    validity === 6 ? 6 : validity === 12 ? 12 : 0;
  return {
    enabled:
      typeof row.enabled === "boolean"
        ? row.enabled
        : DEFAULT_LOYALTY_SETTINGS.enabled,
    pointsPerDelivery: Math.max(
      0,
      safeInt(row.points_per_delivery, DEFAULT_LOYALTY_SETTINGS.pointsPerDelivery)
    ),
    pointsPerRide: Math.max(
      0,
      safeInt(row.points_per_ride, DEFAULT_LOYALTY_SETTINGS.pointsPerRide)
    ),
    conversionPoints: Math.max(
      1,
      safeInt(row.conversion_points, DEFAULT_LOYALTY_SETTINGS.conversionPoints)
    ),
    conversionCreditCents: Math.max(
      1,
      safeInt(
        row.conversion_credit_cents,
        DEFAULT_LOYALTY_SETTINGS.conversionCreditCents
      )
    ),
    creditValidityMonths,
    referralPointsClient: Math.max(
      0,
      safeInt(
        row.referral_points_client,
        DEFAULT_LOYALTY_SETTINGS.referralPointsClient
      )
    ),
    referralPointsDriver: Math.max(
      0,
      safeInt(
        row.referral_points_driver,
        DEFAULT_LOYALTY_SETTINGS.referralPointsDriver
      )
    ),
    currency:
      typeof row.currency === "string" && row.currency.trim()
        ? row.currency.trim()
        : DEFAULT_LOYALTY_SETTINGS.currency,
  };
}
