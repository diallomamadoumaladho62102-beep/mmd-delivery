export type AccountStatus =
  | "active"
  | "suspended"
  | "disabled"
  | "deleted"
  | "banned";

const INACTIVE_STATUSES = new Set<AccountStatus>([
  "suspended",
  "disabled",
  "deleted",
  "banned",
]);

export function normalizeAccountStatus(
  value: string | null | undefined
): AccountStatus {
  const clean = String(value ?? "active").trim().toLowerCase();
  if (clean === "suspended" || clean === "disabled") return clean;
  if (clean === "deleted" || clean === "banned") return clean;
  return "active";
}

export function isAccountActive(status: string | null | undefined): boolean {
  const clean = String(status ?? "active").trim().toLowerCase();
  if (clean === "unknown") return false;
  return !INACTIVE_STATUSES.has(normalizeAccountStatus(status));
}

export function accountStatusBlockMessage(
  status: string | null | undefined
): string | null {
  const normalized = normalizeAccountStatus(status);
  if (normalized === "deleted") {
    return "This account has been deleted and can no longer be used.";
  }
  if (normalized === "banned") {
    return "This account is banned. Contact MMD Delivery support.";
  }
  if (normalized === "suspended") {
    return "Votre compte est suspendu. Contactez le support MMD Delivery.";
  }
  if (normalized === "disabled") {
    return "Votre compte est désactivé. Contactez le support MMD Delivery.";
  }
  if (String(status ?? "").trim().toLowerCase() === "unknown") {
    return "Unable to verify account status.";
  }
  return null;
}

export function accountInactiveApiError(
  status: string | null | undefined
): { error: string; code: "ACCOUNT_INACTIVE"; account_status: AccountStatus } {
  const accountStatus = normalizeAccountStatus(status);
  return {
    error: accountStatusBlockMessage(status) ?? "Account is not active",
    code: "ACCOUNT_INACTIVE",
    account_status: accountStatus,
  };
}

export type DriverOperationalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | "disabled";

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
    return "Votre compte chauffeur est suspendu. Contactez le support MMD Delivery.";
  }
  if (normalized === "disabled") {
    return "Votre compte chauffeur est désactivé. Contactez le support MMD Delivery.";
  }
  if (normalized !== "approved") {
    return "Votre profil chauffeur doit être approuvé avant de passer en ligne.";
  }
  return null;
}

export function isDriverOnlineEligible(
  status: string | null | undefined
): boolean {
  return driverOnlineBlockMessage(status) === null;
}

export type RestaurantOperationalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "disabled";

export function isRestaurantOrderEligible(
  status: string | null | undefined
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}
