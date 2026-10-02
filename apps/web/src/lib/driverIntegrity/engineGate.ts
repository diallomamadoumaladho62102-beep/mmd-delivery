import {
  DEFAULT_DRIVER_INTEGRITY_SETTINGS,
  type DriverIntegritySettings,
} from "./types";

export function asPositiveInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function asPositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function monitoringIsActive(
  settings: Pick<DriverIntegritySettings, "monitoringEnabled">
): boolean {
  return settings.monitoringEnabled === true;
}

export function warningNotificationsAreActive(
  settings: Pick<
    DriverIntegritySettings,
    "monitoringEnabled" | "warningNotificationsEnabled"
  >
): boolean {
  return (
    settings.monitoringEnabled === true &&
    settings.warningNotificationsEnabled === true
  );
}

export function reassignmentIsActive(
  settings: Pick<
    DriverIntegritySettings,
    "monitoringEnabled" | "reassignmentEnabled"
  >
): boolean {
  return (
    settings.monitoringEnabled === true && settings.reassignmentEnabled === true
  );
}

export function reviewIsActive(
  settings: Pick<DriverIntegritySettings, "monitoringEnabled" | "reviewEnabled">
): boolean {
  return settings.monitoringEnabled === true && settings.reviewEnabled === true;
}

export function sanctionWorkflowIsActive(
  settings: Pick<
    DriverIntegritySettings,
    "monitoringEnabled" | "reviewEnabled" | "sanctionWorkflowEnabled"
  >
): boolean {
  return (
    settings.monitoringEnabled === true &&
    settings.reviewEnabled === true &&
    settings.sanctionWorkflowEnabled === true
  );
}

export function contactIsActive(
  settings: Pick<DriverIntegritySettings, "contactEnabled">
): boolean {
  return settings.contactEnabled === true;
}

export function failClosedScanSkipReason(
  settings: DriverIntegritySettings
): string | null {
  if (!monitoringIsActive(settings)) return "monitoring_disabled";
  if (!settings.engineStartAt) return "engine_start_required";
  return null;
}

export function cloneDefaultSettings(): DriverIntegritySettings {
  return { ...DEFAULT_DRIVER_INTEGRITY_SETTINGS };
}
