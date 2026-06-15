import {
  detectPlatformCountryFromCoordinates,
  inferPlatformCountryCode,
} from "@/lib/platformCountryInference";
import { currencyForPlatformCountry } from "@/lib/platformCurrency";

type GenericRow = Record<string, unknown>;

function normalizeCurrency(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function currencyFromOrderRows(rows: GenericRow[]): string | null {
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    if (currency) return currency;
  }
  return null;
}

/**
 * Resolve display currency for a restaurant without relying on
 * restaurant_profiles.currency (not present in production schema).
 *
 * Priority: recent order currency → market/country from coordinates → USD.
 */
export function resolveRestaurantCurrency(params: {
  profile?: GenericRow | null;
  orderRows?: GenericRow[];
}): string {
  const fromOrders = currencyFromOrderRows(params.orderRows ?? []);
  if (fromOrders) return fromOrders;

  const profile = params.profile ?? {};
  const lat = profile.location_lat ?? profile.lat;
  const lng = profile.location_lng ?? profile.lng;

  const countryFromCoords = detectPlatformCountryFromCoordinates(lat, lng);
  if (countryFromCoords) {
    return currencyForPlatformCountry(countryFromCoords);
  }

  const countryCode = inferPlatformCountryCode({ lat, lng });
  return currencyForPlatformCountry(countryCode);
}
