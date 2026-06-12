export const AFRICA_PLATFORM_COUNTRIES = new Set([
  "GN",
  "SN",
  "CI",
  "ML",
  "SL",
  "MR",
]);

const CURRENCY_COUNTRY_MAP: Record<string, string> = {
  USD: "US",
  CAD: "CA",
  GBP: "GB",
  EUR: "FR",
  GNF: "GN",
  XOF: "SN",
  SLE: "SL",
  MRU: "MR",
};

export function normalizePlatformCountryCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
}

/** Rough bounding boxes for supported West/North Africa markets. */
export function detectPlatformCountryFromCoordinates(
  lat?: unknown,
  lng?: unknown
): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  if (
    latitude >= 14.5 &&
    latitude <= 27.5 &&
    longitude >= -17 &&
    longitude <= -4
  ) {
    return "MR";
  }
  if (
    latitude >= 7 &&
    latitude <= 13 &&
    longitude >= -15 &&
    longitude <= -8
  ) {
    return "GN";
  }
  if (
    latitude >= 6.5 &&
    latitude <= 10 &&
    longitude >= -13.5 &&
    longitude <= -10
  ) {
    return "SL";
  }
  if (
    latitude >= 4 &&
    latitude <= 11 &&
    longitude >= -8.5 &&
    longitude <= -2.5
  ) {
    return "CI";
  }
  if (
    latitude >= 12 &&
    latitude <= 17 &&
    longitude >= -18 &&
    longitude <= -11
  ) {
    return "SN";
  }
  if (
    latitude >= 10 &&
    latitude <= 25 &&
    longitude >= -12 &&
    longitude <= 4
  ) {
    return "ML";
  }

  if (
    latitude >= 24.5 &&
    latitude <= 49.5 &&
    longitude >= -125 &&
    longitude <= -66.5
  ) {
    return "US";
  }

  return null;
}

type UsStateBBox = {
  code: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/** Approximate US state bounding boxes for client GPS scope (NY, NJ, PA, FL, CA, TX). */
const US_STATE_BBOXES: UsStateBBox[] = [
  { code: "NY", minLat: 40.49, maxLat: 45.02, minLng: -79.76, maxLng: -71.85 },
  { code: "NJ", minLat: 38.93, maxLat: 41.36, minLng: -75.56, maxLng: -73.89 },
  { code: "PA", minLat: 39.72, maxLat: 42.27, minLng: -80.52, maxLng: -74.69 },
  { code: "FL", minLat: 24.52, maxLat: 31.0, minLng: -87.63, maxLng: -80.03 },
  { code: "CA", minLat: 32.53, maxLat: 42.01, minLng: -124.41, maxLng: -114.13 },
  { code: "TX", minLat: 25.84, maxLat: 36.5, minLng: -106.65, maxLng: -93.51 },
];

export function detectUsStateFromCoordinates(lat?: unknown, lng?: unknown): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  for (const box of US_STATE_BBOXES) {
    if (
      latitude >= box.minLat &&
      latitude <= box.maxLat &&
      longitude >= box.minLng &&
      longitude <= box.maxLng
    ) {
      return box.code;
    }
  }

  return null;
}

export function inferPlatformCountryCode(input?: {
  countryCode?: unknown;
  currency?: unknown;
  lat?: unknown;
  lng?: unknown;
}): string {
  const explicit = normalizePlatformCountryCode(input?.countryCode);
  if (explicit.length === 2) return explicit;

  const fromCoords = detectPlatformCountryFromCoordinates(input?.lat, input?.lng);
  if (fromCoords) return fromCoords;

  const currency = String(input?.currency ?? "")
    .trim()
    .toUpperCase();
  return CURRENCY_COUNTRY_MAP[currency] ?? "US";
}

export function isAfricaPlatformCountry(countryCode: string): boolean {
  return AFRICA_PLATFORM_COUNTRIES.has(normalizePlatformCountryCode(countryCode));
}

export function pricingConfigKeyForOrder(params: {
  orderType: "food" | "errand";
  countryCode?: unknown;
  currency?: unknown;
  lat?: unknown;
  lng?: unknown;
}): string {
  const country = inferPlatformCountryCode(params);
  if (isAfricaPlatformCountry(country)) {
    return params.orderType === "errand" ? "errand_africa" : "food_africa";
  }
  return params.orderType === "errand" ? "errand_default" : "food_default";
}

/** Map profile country text to ISO-3166 alpha-2 for Stripe Connect. */
export function normalizeStripeConnectCountry(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  if (raw === "USA" || raw === "UNITED STATES") return "US";
  if (raw === "CANADA") return "CA";
  if (raw === "UNITED KINGDOM" || raw === "UK") return "GB";
  if (raw === "FRANCE") return "FR";
  if (raw === "BELGIUM") return "BE";
  if (raw === "GUINEA" || raw === "GUINEE") return "GN";
  if (raw === "SENEGAL") return "SN";
  if (raw === "COTE D IVOIRE" || raw === "CÔTE D'IVOIRE" || raw === "IVORY COAST")
    return "CI";
  if (raw === "MALI") return "ML";
  if (raw === "SIERRA LEONE") return "SL";
  if (raw === "MAURITANIA") return "MR";
  return "US";
}
