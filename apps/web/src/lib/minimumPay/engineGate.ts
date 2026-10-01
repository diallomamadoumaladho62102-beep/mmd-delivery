import type { MinimumPayEngineSettings, MinimumPayMode } from "./types";
import { MINIMUM_PAY_MODES } from "./types";

export function parseMinimumPayMode(value: unknown): MinimumPayMode {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((MINIMUM_PAY_MODES as readonly string[]).includes(raw)) {
    return raw as MinimumPayMode;
  }
  return "off";
}

export function engineHasStarted(
  settings: Pick<MinimumPayEngineSettings, "engineStartAt">,
  nowMs: number
): boolean {
  if (!settings.engineStartAt) return false;
  const start = Date.parse(settings.engineStartAt);
  return Number.isFinite(start) && nowMs >= start;
}

export function canRecordMinimumPayEvents(
  settings: MinimumPayEngineSettings,
  nowMs: number
): boolean {
  return (
    (settings.mode === "shadow" || settings.mode === "active") &&
    engineHasStarted(settings, nowMs)
  );
}

export function canCalculateMinimumPay(
  settings: MinimumPayEngineSettings,
  nowMs: number
): boolean {
  return canRecordMinimumPayEvents(settings, nowMs);
}

export function canTransferMinimumPayAdjustments(
  settings: MinimumPayEngineSettings,
  nowMs: number
): boolean {
  return (
    settings.mode === "active" &&
    settings.transfersEnabled === true &&
    engineHasStarted(settings, nowMs)
  );
}

export function isTimestampOnOrAfterStart(
  settings: Pick<MinimumPayEngineSettings, "engineStartAt">,
  timestampIso: string
): boolean {
  if (!settings.engineStartAt) return false;
  const start = Date.parse(settings.engineStartAt);
  const at = Date.parse(timestampIso);
  return Number.isFinite(start) && Number.isFinite(at) && at >= start;
}

export function settingsAreCompleteForPeriods(
  settings: MinimumPayEngineSettings
): boolean {
  return Boolean(
    settings.engineStartAt &&
      settings.timezone &&
      settings.timezone.trim() &&
      settings.periodLengthDays &&
      settings.periodLengthDays > 0 &&
      settings.periodStartWeekday != null &&
      Number.isInteger(settings.periodStartWeekday) &&
      settings.periodStartWeekday >= 0 &&
      settings.periodStartWeekday <= 6 &&
      settings.defaultJurisdiction &&
      settings.defaultJurisdiction.trim() &&
      settings.defaultMethod &&
      settings.defaultMethod.trim() &&
      settings.defaultRounding &&
      settings.defaultRounding.trim()
  );
}
