import {
  DRIVER_WAIT_REASON_CODES,
  type DriverWaitReasonCode,
} from "./types";

export const DRIVER_DISPUTE_REASON_CODES = [
  "restaurant",
  "wait",
  "gps",
  "technical",
  "other",
] as const;

export type DriverDisputeReasonCode =
  (typeof DRIVER_DISPUTE_REASON_CODES)[number];

const WAIT_TO_DISPUTE: Record<DriverWaitReasonCode, DriverDisputeReasonCode> = {
  restaurant_delay: "restaurant",
  order_issue: "restaurant",
  traffic: "wait",
  gps_issue: "gps",
  technical_issue: "technical",
  vehicle_issue: "technical",
  safety_issue: "other",
  other: "other",
};

export const DISPUTE_REASON_I18N_KEYS: Record<DriverDisputeReasonCode, string> =
  {
    restaurant: "Restaurant",
    wait: "Wait",
    gps: "GPS",
    technical: "Technical issue",
    other: "Other",
  };

export function parseDisputeReasonCode(
  value: unknown
): DriverDisputeReasonCode | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((DRIVER_DISPUTE_REASON_CODES as readonly string[]).includes(raw)) {
    return raw as DriverDisputeReasonCode;
  }
  if ((DRIVER_WAIT_REASON_CODES as readonly string[]).includes(raw)) {
    return WAIT_TO_DISPUTE[raw as DriverWaitReasonCode];
  }
  return null;
}
