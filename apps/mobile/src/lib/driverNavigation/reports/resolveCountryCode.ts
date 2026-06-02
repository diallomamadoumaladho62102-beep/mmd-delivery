import {
  normalizeCountryCode,
  type DriverMapCountryCode,
} from "./config";

const IS_DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

export type DriverMapCountryCodeSource =
  | "order"
  | "driver_profile"
  | "profile"
  | "fallback";

export type ResolvedDriverMapCountryCode = {
  countryCode: DriverMapCountryCode;
  source: DriverMapCountryCodeSource;
};

export const DRIVER_MAP_COUNTRY_CODE_FALLBACK: DriverMapCountryCode = "US";

function pickSupportedCountryCode(
  value: unknown,
  source: DriverMapCountryCodeSource,
): DriverMapCountryCode | null {
  if (value == null || String(value).trim() === "") {
    return null;
  }

  const normalized = normalizeCountryCode(value);
  if (normalized) {
    return normalized;
  }

  if (IS_DEV) {
    console.warn(
      `[DriverMapCountryCode] Unsupported country from ${source}:`,
      value,
    );
  }

  return null;
}

export function resolveDriverMapCountryCode(input: {
  orderCountryCode?: unknown;
  driverOperatingCountry?: unknown;
  driverCountryCode?: unknown;
  profileCountryCode?: unknown;
}): ResolvedDriverMapCountryCode {
  const fromOrder = pickSupportedCountryCode(input.orderCountryCode, "order");
  if (fromOrder) {
    return { countryCode: fromOrder, source: "order" };
  }

  const fromDriverProfile = pickSupportedCountryCode(
    input.driverOperatingCountry ?? input.driverCountryCode,
    "driver_profile",
  );
  if (fromDriverProfile) {
    return { countryCode: fromDriverProfile, source: "driver_profile" };
  }

  const fromProfile = pickSupportedCountryCode(
    input.profileCountryCode,
    "profile",
  );
  if (fromProfile) {
    return { countryCode: fromProfile, source: "profile" };
  }

  if (IS_DEV) {
    console.warn(
      "[DriverMapCountryCode] No supported country detected — using fallback US.",
    );
  }

  return {
    countryCode: DRIVER_MAP_COUNTRY_CODE_FALLBACK,
    source: "fallback",
  };
}

export function extractCountryCodeField(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  return row.country_code ?? row.countryCode ?? null;
}
