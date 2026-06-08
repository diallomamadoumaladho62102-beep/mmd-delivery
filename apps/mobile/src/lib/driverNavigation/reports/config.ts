/**
 * Driver map reports — global architecture (delivery + taxi, ISO country codes).
 */
export const DRIVER_MAP_REPORTS = {
  enabled: true,
  defaultTtlMinutes: 25,
  maxVisibleRadiusMeters: 5000,
  maxReportsPerDriverPerHour: 6,
  nearbyRefreshMs: 90_000,
  maxMapMarkers: 0,
} as const;

export type DriverMapReportCategory =
  | "accident"
  | "traffic_jam"
  | "road_closed"
  | "hazard"
  | "police"
  | "bad_address"
  | "other";

export type DriverMapModuleType = "delivery" | "taxi";

/** ISO-3166-1 alpha-2 codes seeded in driver_map_report_countries (v1.1). */
export type DriverMapCountryCode =
  | "US"
  | "GN"
  | "SN"
  | "CI"
  | "ML"
  | "NG"
  | "GH"
  | "SL"
  | "MR"
  | "CA"
  | "FR"
  | "BE"
  | "GB"
  | "DE";

export type DriverMapReportSourceTable = "orders" | "delivery_requests" | "taxi_rides";

export const DRIVER_MAP_SUPPORTED_COUNTRY_CODES: readonly DriverMapCountryCode[] = [
  "US",
  "GN",
  "SN",
  "CI",
  "ML",
  "NG",
  "GH",
  "SL",
  "MR",
  "CA",
  "FR",
  "BE",
  "GB",
  "DE",
] as const;

export type DriverMapReportDraft = {
  category: DriverMapReportCategory;
  latitude: number;
  longitude: number;
  description?: string;
  orderId?: string | null;
  sourceTable?: DriverMapReportSourceTable | null;
  moduleType: DriverMapModuleType;
  countryCode: DriverMapCountryCode;
};

export type DriverMapReportRecord = {
  id: string;
  driverId: string;
  category: DriverMapReportCategory;
  latitude: number;
  longitude: number;
  description?: string | null;
  orderId?: string | null;
  sourceTable?: DriverMapReportSourceTable | null;
  moduleType: DriverMapModuleType;
  countryCode: DriverMapCountryCode;
  expiresAt: string;
  createdAt: string;
  isActive: boolean;
};

export const DRIVER_MAP_REPORT_LABELS: Record<DriverMapReportCategory, string> = {
  accident: "Accident",
  traffic_jam: "Embouteillage",
  road_closed: "Route fermée",
  hazard: "Danger",
  police: "Police",
  bad_address: "Mauvaise adresse",
  other: "Autre problème",
};

export const DRIVER_MAP_REPORT_CATEGORIES = Object.keys(
  DRIVER_MAP_REPORT_LABELS,
) as DriverMapReportCategory[];

export function normalizeCountryCode(value: unknown): DriverMapCountryCode | null {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) return null;
  return (DRIVER_MAP_SUPPORTED_COUNTRY_CODES as readonly string[]).includes(code)
    ? (code as DriverMapCountryCode)
    : null;
}

export function isSupportedCountryCode(value: unknown): value is DriverMapCountryCode {
  return normalizeCountryCode(value) != null;
}

export function computeReportExpiresAt(
  createdAt: Date = new Date(),
  ttlMinutes = DRIVER_MAP_REPORTS.defaultTtlMinutes,
): string {
  return new Date(createdAt.getTime() + ttlMinutes * 60_000).toISOString();
}

export function isReportExpired(expiresAt: string, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

export const DEFAULT_DRIVER_MAP_REPORT_CONTEXT = {
  moduleType: "delivery" as DriverMapModuleType,
  countryCode: "US" as DriverMapCountryCode,
};
