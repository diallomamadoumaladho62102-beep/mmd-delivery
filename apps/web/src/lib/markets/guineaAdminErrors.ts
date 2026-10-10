const ADMIN_ERROR_LABELS: Record<string, string> = {
  guinea_standard_schema_not_ready: "Guinea standard settings are not ready",
  guinea_rate_conflict: "That fare was changed by someone else. Reload the page.",
  guinea_rate_invalid: "The fare values are not valid.",
  guinea_commission_not_configured: "The commission value is not valid.",
  guinea_catalog_failed: "The fare catalog could not be loaded.",
  currency_mismatch: "The currency must stay GNF.",
  xl_catalog_failed: "The XL catalog could not be loaded.",
  xl_rate_invalid: "The XL rate is not valid.",
  xl_rate_conflict: "That XL rate changed. Reload the page.",
  xl_route_not_configured: "This XL route is not configured.",
  xl_commission_not_configured: "The XL commission is not valid.",
  xl_baggage_invalid: "The baggage band is not valid.",
  xl_booking_invalid: "The XL booking is not valid.",
  xl_segment_schema_not_ready: "XL segments are not ready",
  xl_segment_not_priced: "This segment is not priced",
  xl_segment_conflict: "That segment changed. Reload the page.",
  xl_segment_inactive: "This segment is inactive",
  xl_segment_unconfirmed: "This segment is still an unconfirmed estimate",
  xl_segment_path_invalid: "This route is not a valid segment path",
  xl_one_passenger_per_reservation: "Each reservation is for one passenger",
  xl_segment_commercial_disabled: "Segment bookings are not open",
  xl_dispatch_not_configured: "Dispatch rules are not configured",
  xl_dispatch_no_driver: "No admissible driver",
  xl_dispatch_pickup_required: "Pickup coordinates are required",
  xl_pickup_time_required: "Pickup time is required",
  xl_driver_location_unavailable: "Driver location is unavailable",
  xl_driver_too_far: "No admissible driver",
  xl_driver_wrong_direction: "No admissible driver",
  xl_detour_exceeded: "No admissible driver",
  xl_pickup_delay: "No admissible driver",
  xl_pickup_passed: "No admissible driver",
  xl_departure_completed: "This departure is completed",
  xl_departure_canceled: "This departure is canceled",
  xl_driver_unavailable: "No admissible driver",
  xl_progress_unverified: "No admissible driver",
  xl_progress_inconsistent: "No admissible driver",
  xl_dispatch_no_verified_driver: "No admissible driver",
};

const CONFIG_SOURCE_LABELS: Record<string, string> = {
  database: "Saved in the database",
  environment: "Read from the server environment",
  missing: "Not configured",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  rates_saved: "Rates saved",
  axis_created: "Axis created",
  commission_changed: "Commission changed",
  baggage_band_saved: "Baggage band saved",
  update_rate: "XL rate updated",
  set_active: "XL route activated or deactivated",
  segment_tariff_saved: "Segment tariff saved",
  segment_updated: "Segment updated",
  segment_activation: "Segment activated or deactivated",
  segment_dispatch_saved: "Dispatch rules saved",
};

/** Stable API codes stay on the server. The screen translates the label. */
export function guineaAdminErrorLabel(code: unknown): string {
  return ADMIN_ERROR_LABELS[String(code ?? "")] ?? "Update failed";
}

export function guineaConfigSourceLabel(source: unknown): string {
  return CONFIG_SOURCE_LABELS[String(source ?? "")] ?? "Not configured";
}

export function guineaAuditActionLabel(action: unknown): string {
  return AUDIT_ACTION_LABELS[String(action ?? "")] ?? "Recorded change";
}
