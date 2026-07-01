import {
  DEFAULT_TAXI_COUNTRY_CODE,
  normalizeTaxiCountryCode,
} from "@/lib/taxiCountries";

export const TAXI_SUPPORTED_COUNTRY_CODES = new Set([
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

export type TaxiCountryResolutionSource = "coords" | "manual" | "default";

export type TaxiCountryResolution = {
  countryCode: string;
  source: TaxiCountryResolutionSource;
  detectedCountryCode: string | null;
  manualCountryCode: string | null;
};

type MapboxCountryFeature = {
  properties?: { short_code?: string };
};

function mapboxShortCodeToCountry(code: unknown): string | null {
  const raw = String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/^([A-Z]{2})-.+$/, "$1");
  if (raw.length !== 2) return null;
  return TAXI_SUPPORTED_COUNTRY_CODES.has(raw) ? raw : null;
}

/** Reverse-geocode pickup coordinates to a supported taxi country (Mapbox). */
export async function detectTaxiCountryFromCoords(
  lat: unknown,
  lng: unknown
): Promise<string | null> {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
    `?types=country&limit=1&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as {
      features?: MapboxCountryFeature[];
    } | null;

    if (!res.ok) return null;

    const feature = data?.features?.[0];
    return mapboxShortCodeToCountry(feature?.properties?.short_code);
  } catch {
    return null;
  }
}

export function resolveTaxiCountryForRide(input: {
  manualCountryCode?: unknown;
  detectedCountryCode?: string | null;
}): { ok: true; resolution: TaxiCountryResolution } | { ok: false; message: string; error: string; detected_country_code?: string; manual_country_code?: string } {
  const manualRaw = input.manualCountryCode;
  const manualProvided =
    manualRaw != null && String(manualRaw).trim().length > 0;
  const manualCountryCode = manualProvided
    ? normalizeTaxiCountryCode(manualRaw)
    : null;
  const detectedCountryCode = input.detectedCountryCode ?? null;

  if (
    detectedCountryCode &&
    manualCountryCode &&
    detectedCountryCode !== manualCountryCode
  ) {
    return {
      ok: false,
      error: "country_mismatch",
      message: "Pickup location country does not match selected country",
      detected_country_code: detectedCountryCode,
      manual_country_code: manualCountryCode,
    };
  }

  if (detectedCountryCode) {
    return {
      ok: true,
      resolution: {
        countryCode: detectedCountryCode,
        source: "coords",
        detectedCountryCode,
        manualCountryCode,
      },
    };
  }

  if (manualCountryCode) {
    return {
      ok: true,
      resolution: {
        countryCode: manualCountryCode,
        source: "manual",
        detectedCountryCode: null,
        manualCountryCode,
      },
    };
  }

  return {
    ok: true,
    resolution: {
      countryCode: DEFAULT_TAXI_COUNTRY_CODE,
      source: "default",
      detectedCountryCode: null,
      manualCountryCode: null,
    },
  };
}

export async function resolveTaxiCountryWithDetection(input: {
  manualCountryCode?: unknown;
  pickupLat?: unknown;
  pickupLng?: unknown;
}): Promise<
  | { ok: true; resolution: TaxiCountryResolution }
  | {
      ok: false;
      message: string;
      error: string;
      detected_country_code?: string;
      manual_country_code?: string;
    }
> {
  const detectedCountryCode = await detectTaxiCountryFromCoords(
    input.pickupLat,
    input.pickupLng
  );

  return resolveTaxiCountryForRide({
    manualCountryCode: input.manualCountryCode,
    detectedCountryCode,
  });
}
