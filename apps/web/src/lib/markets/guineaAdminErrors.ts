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
