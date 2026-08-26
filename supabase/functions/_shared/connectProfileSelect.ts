/**
 * Stripe Connect profile SELECT attempts.
 * restaurant_profiles has never had a `state` column in this repo — callers
 * must fall back instead of failing with:
 *   "column restaurant_profiles.state does not exist"
 *
 * Pure TypeScript (no Deno APIs) so Node tests can import it.
 */

export type ConnectProfileRole = "driver" | "restaurant" | "seller";

export function isMissingRelationColumnError(message: unknown): boolean {
  const msg = String(message ?? "");
  return /column .+ does not exist|Could not find the '.+' column|schema cache/i.test(
    msg,
  );
}

const BASE = "stripe_account_id";

/** Narrower selects first would skip optional geo; try richest first, then drop. */
export function connectProfileSelectAttempts(
  role: ConnectProfileRole,
): string[] {
  if (role === "seller") {
    return [
      `${BASE}, city, country_code`,
      `${BASE}, city`,
      BASE,
    ];
  }
  if (role === "restaurant") {
    return [
      `${BASE}, city, state, country_code`,
      `${BASE}, city, country_code`,
      `${BASE}, city, state`,
      `${BASE}, city`,
      BASE,
    ];
  }
  return [`${BASE}, city, state`, `${BASE}, city`, BASE];
}
