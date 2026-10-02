import {
  DRIVER_WAIT_REASON_CODES,
  type DriverWaitReasonCode,
} from "./types";

export function parseWaitReasonCode(value: unknown): DriverWaitReasonCode | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if ((DRIVER_WAIT_REASON_CODES as readonly string[]).includes(raw)) {
    return raw as DriverWaitReasonCode;
  }
  return null;
}

export const WAIT_REASON_I18N_KEYS: Record<DriverWaitReasonCode, string> = {
  restaurant_delay: "Restaurant delay",
  order_issue: "Order issue",
  traffic: "Traffic",
  gps_issue: "GPS issue",
  technical_issue: "Technical issue",
  vehicle_issue: "Vehicle issue",
  safety_issue: "Safety issue",
  other: "Other",
};

export function waitReasonDoesNotMutateTimestamps(): true {
  return true;
}
