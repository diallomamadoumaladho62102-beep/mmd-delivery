import type { SupabaseClient } from "@supabase/supabase-js";
import { asPositiveInt, asPositiveNumber } from "./engineGate";
import {
  DEFAULT_DRIVER_INTEGRITY_SETTINGS,
  type DriverIntegritySettings,
} from "./types";

function asBool(value: unknown, fallback = false): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

export function mapIntegritySettingsRow(
  row: Record<string, unknown> | null | undefined
): DriverIntegritySettings {
  if (!row) return { ...DEFAULT_DRIVER_INTEGRITY_SETTINGS };
  return {
    monitoringEnabled: asBool(row.monitoring_enabled),
    warningNotificationsEnabled: asBool(row.warning_notifications_enabled),
    reassignmentEnabled: asBool(row.reassignment_enabled),
    contactEnabled: asBool(row.contact_enabled),
    reviewEnabled: asBool(row.review_enabled),
    sanctionWorkflowEnabled: asBool(row.sanction_workflow_enabled),
    driverAcceptanceWarningAfterSeconds: asPositiveInt(
      row.driver_acceptance_warning_after_seconds
    ),
    driverNoProgressReassignmentAfterSeconds: asPositiveInt(
      row.driver_no_progress_reassignment_after_seconds
    ),
    driverPickupProgressWarningAfterSeconds: asPositiveInt(
      row.driver_pickup_progress_warning_after_seconds
    ),
    driverNoProgressReviewAfterSeconds: asPositiveInt(
      row.driver_no_progress_review_after_seconds
    ),
    restaurantWaitReviewThresholdSeconds: asPositiveInt(
      row.restaurant_wait_review_threshold_seconds
    ),
    longTripThresholdSeconds: asPositiveInt(row.long_trip_threshold_seconds),
    stationaryThresholdSeconds: asPositiveInt(row.stationary_threshold_seconds),
    impossibleSpeedThresholdMps: asPositiveNumber(
      row.impossible_speed_threshold_mps
    ),
    gpsStaleAfterSeconds: asPositiveInt(row.gps_stale_after_seconds),
    gpsJumpThresholdMeters: asPositiveInt(row.gps_jump_threshold_meters),
    movementProgressThresholdMeters: asPositiveInt(
      row.movement_progress_threshold_meters
    ),
    requireChangeReason: row.require_change_reason !== false,
  };
}

export async function loadDriverIntegritySettings(
  supabase: SupabaseClient
): Promise<DriverIntegritySettings> {
  const { data, error } = await supabase
    .from("driver_integrity_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_DRIVER_INTEGRITY_SETTINGS };
  return mapIntegritySettingsRow(data as Record<string, unknown>);
}

export const SENSITIVE_FLAG_KEYS = [
  "monitoring_enabled",
  "warning_notifications_enabled",
  "reassignment_enabled",
  "sanction_workflow_enabled",
] as const;
