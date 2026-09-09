import i18n from "i18next";

export type AccountStatus =
  | "active"
  | "suspended"
  | "disabled"
  | "deleted"
  | "banned";

function tr(key: string, defaultValue: string): string {
  try {
    const value = i18n.t(key, { defaultValue });
    return typeof value === "string" && value.trim() ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function normalizeAccountStatus(
  value: string | null | undefined
): AccountStatus {
  const clean = String(value ?? "active").trim().toLowerCase();
  if (
    clean === "suspended" ||
    clean === "disabled" ||
    clean === "deleted" ||
    clean === "banned"
  ) {
    return clean;
  }
  return "active";
}

export function isAccountActive(status: string | null | undefined): boolean {
  const clean = String(status ?? "").trim().toLowerCase();
  if (!clean || clean === "unknown") return false;
  return normalizeAccountStatus(status) === "active";
}

export function accountStatusBlockMessage(
  status: string | null | undefined
): string | null {
  const normalized = normalizeAccountStatus(status);
  if (normalized === "deleted") {
    return tr(
      "errors.account.deleted",
      "This account has been deleted and can no longer be used.",
    );
  }
  if (normalized === "banned") {
    return tr(
      "errors.account.banned",
      "This account is banned. Contact MMD Delivery support.",
    );
  }
  if (normalized === "suspended") {
    return tr(
      "errors.account.suspended",
      "Your account is suspended. Contact MMD Delivery support.",
    );
  }
  if (normalized === "disabled") {
    return tr(
      "errors.account.disabled",
      "Your account is disabled. Contact MMD Delivery support.",
    );
  }
  if (String(status ?? "").trim().toLowerCase() === "unknown") {
    return tr(
      "errors.account.unknown",
      "Unable to verify account status. Please try again shortly.",
    );
  }
  return null;
}

export function isDriverDispatchEligible(
  status: string | null | undefined
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}

export function driverOnlineBlockMessage(
  status: string | null | undefined
): string | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "suspended") {
    return tr(
      "errors.codes.driver_suspended",
      "Your driver account is suspended.",
    );
  }
  if (normalized === "disabled") {
    return tr(
      "errors.codes.driver_disabled",
      "Your driver account is disabled.",
    );
  }
  if (normalized !== "approved") {
    return tr(
      "errors.codes.driver_not_approved",
      "Your driver account must be approved before you can go online.",
    );
  }
  return null;
}

export function isDriverOnlineEligible(
  status: string | null | undefined
): boolean {
  return driverOnlineBlockMessage(status) === null;
}

export function isRestaurantOrderEligible(
  status: string | null | undefined
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}
