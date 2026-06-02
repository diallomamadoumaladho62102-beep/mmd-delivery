import { supabase } from "../../supabase";
import { isValidCoordinate } from "../../coordinates";
import {
  DRIVER_MAP_REPORTS,
  isSupportedCountryCode,
  normalizeCountryCode,
  type DriverMapCountryCode,
  type DriverMapModuleType,
  type DriverMapReportCategory,
  type DriverMapReportDraft,
  type DriverMapReportRecord,
  type DriverMapReportSourceTable,
} from "./config";

export type SubmitDriverMapReportResult =
  | { ok: true; report: DriverMapReportRecord }
  | {
      ok: false;
      reason:
        | "disabled"
        | "rate_limited"
        | "network"
        | "invalid_coords"
        | "invalid_country"
        | "unknown";
      message?: string;
    };

export type FetchNearbyReportsResult = {
  reports: DriverMapReportRecord[];
};

type DriverMapReportRow = {
  id: string;
  driver_id: string;
  category: DriverMapReportCategory;
  latitude: number;
  longitude: number;
  description?: string | null;
  order_id?: string | null;
  source_table?: DriverMapReportSourceTable | null;
  module_type: DriverMapModuleType;
  country_code: string;
  expires_at: string;
  created_at: string;
  is_active: boolean;
};

function mapRow(row: DriverMapReportRow): DriverMapReportRecord | null {
  const countryCode = normalizeCountryCode(row.country_code);
  if (!countryCode) return null;

  return {
    id: row.id,
    driverId: row.driver_id,
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description ?? null,
    orderId: row.order_id ?? null,
    sourceTable: row.source_table ?? null,
    moduleType: row.module_type,
    countryCode,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    isActive: row.is_active,
  };
}

export async function submitDriverMapReport(
  driverId: string,
  draft: DriverMapReportDraft,
): Promise<SubmitDriverMapReportResult> {
  if (!DRIVER_MAP_REPORTS.enabled) {
    return { ok: false, reason: "disabled" };
  }

  if (!driverId) {
    return { ok: false, reason: "unknown", message: "Session chauffeur invalide." };
  }

  if (!isValidCoordinate(draft.latitude, draft.longitude)) {
    return { ok: false, reason: "invalid_coords", message: "Position GPS invalide." };
  }

  if (!isSupportedCountryCode(draft.countryCode)) {
    return {
      ok: false,
      reason: "invalid_country",
      message: "Pays non pris en charge pour les signalements.",
    };
  }

  try {
    const { data, error } = await supabase.rpc("driver_submit_map_report", {
      p_category: draft.category,
      p_latitude: draft.latitude,
      p_longitude: draft.longitude,
      p_country_code: draft.countryCode,
      p_description: draft.description ?? null,
      p_order_id: draft.orderId ?? null,
      p_source_table: draft.sourceTable ?? null,
      p_module_type: draft.moduleType,
    });

    if (error) {
      const message = error.message ?? "Impossible d'enregistrer le signalement.";
      if (/rate.?limit|too many|max_reports/i.test(message)) {
        return { ok: false, reason: "rate_limited", message };
      }
      if (/unsupported_country|invalid_country/i.test(message)) {
        return { ok: false, reason: "invalid_country", message };
      }
      return { ok: false, reason: "network", message };
    }

    const row = (Array.isArray(data) ? data[0] : data) as DriverMapReportRow | null;
    const mapped = row ? mapRow(row) : null;
    if (!mapped) {
      return { ok: false, reason: "unknown", message: "Réponse serveur invalide." };
    }

    return { ok: true, report: mapped };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "Erreur réseau.",
    };
  }
}

export async function fetchNearbyDriverMapReports(params: {
  latitude: number;
  longitude: number;
  countryCode: DriverMapCountryCode;
  radiusMeters?: number;
  moduleType?: DriverMapModuleType;
}): Promise<FetchNearbyReportsResult> {
  if (!DRIVER_MAP_REPORTS.enabled) {
    return { reports: [] };
  }

  if (!isValidCoordinate(params.latitude, params.longitude)) {
    return { reports: [] };
  }

  if (!isSupportedCountryCode(params.countryCode)) {
    return { reports: [] };
  }

  try {
    const { data, error } = await supabase.rpc("driver_fetch_active_map_reports", {
      p_latitude: params.latitude,
      p_longitude: params.longitude,
      p_country_code: params.countryCode,
      p_radius_meters: params.radiusMeters ?? DRIVER_MAP_REPORTS.maxVisibleRadiusMeters,
      p_module_type: params.moduleType ?? null,
    });

    if (error || !data) {
      return { reports: [] };
    }

    return {
      reports: (data as DriverMapReportRow[])
        .map(mapRow)
        .filter((report): report is DriverMapReportRecord => report != null),
    };
  } catch {
    return { reports: [] };
  }
}

export function getDriverMapReportsChannelName(
  moduleType: DriverMapModuleType = "delivery",
  countryCode: DriverMapCountryCode = "US",
): string {
  return `driver-map-reports:${moduleType}:${countryCode}`;
}
