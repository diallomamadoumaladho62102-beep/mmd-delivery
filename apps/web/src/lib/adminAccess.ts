import { type UserRole } from "@/lib/roles";

/**
 * Centralized admin authorization rules.
 */

function isAdmin(role: UserRole | null | undefined): boolean {
  if (!role) return false;

  // normalise le rôle (évite bug majuscule/minuscule)
  return role.toLowerCase() === "admin";
}

/**
 * Global admin dashboard access
 */
export function canAccessAdminDashboard(role: UserRole | null): boolean {
  return isAdmin(role);
}

/**
 * Payouts read access
 */
export function canAccessPayouts(role: UserRole | null): boolean {
  return isAdmin(role);
}

/**
 * Payout retry permission
 */
export function canRetryPayout(role: UserRole | null): boolean {
  return isAdmin(role);
}

/**
 * Driver review permission
 */
export function canReviewDrivers(role: UserRole | null): boolean {
  return isAdmin(role);
}

/**
 * Restaurant review permission
 */
export function canReviewRestaurants(role: UserRole | null): boolean {
  return isAdmin(role);
}

/**
 * Audit / anomalies / reconciliation access
 */
export function canAccessAuditLogs(role: UserRole | null): boolean {
  return isAdmin(role);
}