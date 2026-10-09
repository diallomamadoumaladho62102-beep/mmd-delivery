/**
 * Orange Money Guinea is prepared and disabled.
 * Credentials, API host, and webhook secret stay in the environment
 * and are read only after MMD turns the flag on. This module never
 * stores or invents them, and it never creates a transaction.
 */

export const ORANGE_MONEY_PAYMENT_METHOD = "orange_money" as const;

export const ORANGE_MONEY_STATUSES = [
  "pending",
  "initiated",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "expired",
] as const;

export type OrangeMoneyStatus = (typeof ORANGE_MONEY_STATUSES)[number];

export type OrangeMoneyGuineaConfig = {
  enabled: boolean;
  country: "GN";
  paymentMethod: typeof ORANGE_MONEY_PAYMENT_METHOD;
};

export function isOrangeMoneyGuineaEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (String(env.ORANGE_MONEY_GN_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return false;
  }
  const merchantKey = String(env.ORANGE_MONEY_GN_MERCHANT_KEY ?? "").trim();
  const accessToken = String(env.ORANGE_MONEY_GN_ACCESS_TOKEN ?? "").trim();
  return merchantKey.length > 0 && accessToken.length > 0;
}

export function orangeMoneyGuineaConfig(
  env: Record<string, string | undefined> = process.env,
): OrangeMoneyGuineaConfig {
  return {
    enabled: isOrangeMoneyGuineaEnabled(env),
    country: "GN",
    paymentMethod: ORANGE_MONEY_PAYMENT_METHOD,
  };
}
