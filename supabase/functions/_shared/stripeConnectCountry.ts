/**
 * Resolve Stripe Connect Express `country` for restaurant/driver onboarding.
 * Pure TypeScript — no Deno APIs — so Node/tsx unit tests can import it.
 *
 * NEVER send US state codes (NY, OH, CA, …) as Stripe `country`.
 * Explicit `country_code=CA` means Canada; `state=CA` means California → US.
 */

/** ISO countries we intentionally accept for Connect Express. */
export const STRIPE_CONNECT_COUNTRY_ALLOWLIST = new Set([
  "US",
  "CA",
  "GB",
  "FR",
  "BE",
  "GN",
  "SN",
  "CI",
  "ML",
  "SL",
  "MR",
]);

/**
 * US state / territory codes. Must NEVER be sent to Stripe as `country`.
 * Includes CA so California is not treated as Canada unless country_code=CA.
 */
export const US_STATE_OR_TERRITORY_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
  "VI", "GU", "AS", "MP",
]);

const US_STATE_NAMES = new Set([
  "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO",
  "CONNECTICUT", "DELAWARE", "FLORIDA", "GEORGIA", "HAWAII", "IDAHO",
  "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE",
  "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI",
  "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY",
  "NEW MEXICO", "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO",
  "OKLAHOMA", "OREGON", "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA",
  "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
  "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING", "DISTRICT OF COLUMBIA",
]);

function scrub(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/['’]/g, "");
}

/** Map known aliases / ISO codes onto the allowlist. Returns null if unknown. */
export function normalizeAllowlistedConnectCountry(value: unknown): string | null {
  const raw = scrub(value);
  if (!raw) return null;

  if (raw === "USA" || raw === "UNITED STATES" || raw === "UNITED STATES OF AMERICA") {
    return "US";
  }
  if (raw === "CANADA") return "CA";
  if (raw === "UNITED KINGDOM" || raw === "UK" || raw === "GREAT BRITAIN") return "GB";
  if (raw === "FRANCE") return "FR";
  if (raw === "BELGIUM") return "BE";
  if (raw === "GUINEA" || raw === "GUINEE" || raw === "REPUBLIC OF GUINEA") return "GN";
  if (raw === "SENEGAL") return "SN";
  if (
    raw === "COTE D IVOIRE" ||
    raw === "COTE DIVOIRE" ||
    raw === "IVORY COAST"
  ) {
    return "CI";
  }
  if (raw === "MALI") return "ML";
  if (raw === "SIERRA LEONE") return "SL";
  if (raw === "MAURITANIA") return "MR";

  if (/^[A-Z]{2}$/.test(raw) && STRIPE_CONNECT_COUNTRY_ALLOWLIST.has(raw)) {
    return raw;
  }

  return null;
}

/** Infer from city text hints (West Africa hubs, common US cities). */
export function inferConnectCountryFromCity(city: unknown): string | null {
  const cityText = scrub(city);
  if (!cityText) return null;

  if (cityText.includes("CONAKRY") || cityText.includes("GUINE")) return "GN";
  if (cityText.includes("DAKAR") || cityText.includes("SENEGAL")) return "SN";
  if (cityText.includes("ABIDJAN") || cityText.includes("IVOIRE")) return "CI";
  if (cityText.includes("BAMAKO") || cityText.includes("MALI")) return "ML";
  if (cityText.includes("FREETOWN") || cityText.includes("SIERRA")) return "SL";
  if (cityText.includes("NOUAKCHOTT") || cityText.includes("MAURITAN")) return "MR";
  if (
    cityText.includes("NEW YORK") ||
    cityText.includes("CANAL WINCHESTER") ||
    cityText.includes("COLUMBUS")
  ) {
    return "US";
  }
  return null;
}

/** True when `state` looks like a US state/territory code or full name. */
export function isUsStateValue(state: unknown): boolean {
  const raw = scrub(state);
  if (!raw) return false;
  if (US_STATE_OR_TERRITORY_CODES.has(raw)) return true;
  if (US_STATE_NAMES.has(raw) || US_STATE_NAMES.has(raw.replace(/\s+/g, " "))) {
    return true;
  }
  return false;
}

export type ResolveStripeConnectCountryInput = {
  /** Explicit request body country (preferred). */
  bodyCountryCode?: unknown;
  /** Profile `country_code` when present. */
  profileCountryCode?: unknown;
  city?: unknown;
  state?: unknown;
  /** Optional loose country text from profile (not state). */
  country?: unknown;
};

/**
 * Resolve Stripe Connect country with safe precedence:
 * 1) body.country_code if allowlisted ISO
 * 2) profile.country_code if allowlisted
 * 3) city hints (Conakry→GN, Dakar→SN, …)
 * 4) US state code/name → US (never send NY/OH/CA as country)
 * 5) state/country if allowlisted ISO country
 * 6) default US
 */
export function resolveStripeConnectCountry(
  input: ResolveStripeConnectCountryInput,
): string {
  const fromBody = normalizeAllowlistedConnectCountry(input.bodyCountryCode);
  if (fromBody) return fromBody;

  const fromProfile = normalizeAllowlistedConnectCountry(input.profileCountryCode);
  if (fromProfile) return fromProfile;

  const fromCity = inferConnectCountryFromCity(input.city);
  if (fromCity) return fromCity;

  if (isUsStateValue(input.state)) return "US";

  const fromStateAsCountry = normalizeAllowlistedConnectCountry(input.state);
  // Only accept if state is NOT a US code (already handled) and is allowlisted.
  // Note: CA as state already returned US above.
  if (fromStateAsCountry) return fromStateAsCountry;

  const fromCountry = normalizeAllowlistedConnectCountry(input.country);
  if (fromCountry) return fromCountry;

  return "US";
}
