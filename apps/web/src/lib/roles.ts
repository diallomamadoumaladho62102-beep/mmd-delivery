/**
 * Web role helpers — thin re-export of the canonical shared module.
 * Prefer importing from `@mmd/platform-roles` in new code.
 */
export {
  PROFILE_ROLES,
  PUBLIC_ROLES,
  STAFF_ROLES,
  SUPER_ADMIN_ROLE,
  CREATABLE_STAFF_ROLES,
  normalizeProfileRole,
  normalizeStaffRole,
  isProfileRole,
  isStaffRole,
  isPublicRole,
  roleDisplayName,
  type ProfileRole,
  type PublicRole,
  type StaffRole,
} from "@mmd/platform-roles";

import { normalizeProfileRole, type ProfileRole } from "@mmd/platform-roles";

/** Stored canonical role (or null). */
export type NonNullUserRole = ProfileRole;
/**
 * Inbound role value at API/UI boundaries. May be a legacy alias before
 * normalizeUserRole(); persisted values are always ProfileRole.
 */
export type UserRole = string | null;

export const USER_ROLES = [
  "super_admin",
  "operations_admin",
  "finance_admin",
  "support_admin",
  "review_admin",
  "restaurant",
  "driver",
  "client",
  "seller",
] as const;

export function normalizeUserRole(value: unknown): ProfileRole | null {
  return normalizeProfileRole(value);
}

export function hasAnyRole(
  role: UserRole,
  allowed: readonly string[],
): boolean {
  if (role === null) return false;
  const canonical = normalizeProfileRole(role);
  if (!canonical) return false;
  return allowed.some((a) => normalizeProfileRole(a) === canonical);
}

export function isAdmin(role: UserRole): boolean {
  return normalizeProfileRole(role) === "super_admin";
}

export function isOps(role: UserRole): boolean {
  const r = normalizeProfileRole(role);
  return r === "operations_admin" || r === "super_admin";
}

export function isSupport(role: UserRole): boolean {
  const r = normalizeProfileRole(role);
  return r === "support_admin" || r === "super_admin";
}

export function isFinance(role: UserRole): boolean {
  const r = normalizeProfileRole(role);
  return r === "finance_admin" || r === "super_admin";
}

export function isReview(role: UserRole): boolean {
  const r = normalizeProfileRole(role);
  return r === "review_admin" || r === "super_admin";
}

export function isRestaurant(role: UserRole): boolean {
  return normalizeProfileRole(role) === "restaurant";
}

export function isDriver(role: UserRole): boolean {
  return normalizeProfileRole(role) === "driver";
}

export function isClient(role: UserRole): boolean {
  return normalizeProfileRole(role) === "client";
}

export function isSeller(role: UserRole): boolean {
  return normalizeProfileRole(role) === "seller";
}

export const ADMIN_ACCESS_ROLES = ["super_admin"] as const;
export const OPS_ACCESS_ROLES = ["super_admin", "operations_admin"] as const;
export const SUPPORT_ACCESS_ROLES = ["super_admin", "support_admin"] as const;
export const FINANCE_ACCESS_ROLES = ["super_admin", "finance_admin"] as const;
export const RESTAURANT_ACCESS_ROLES = ["restaurant"] as const;
export const DRIVER_ACCESS_ROLES = ["driver"] as const;
export const CLIENT_ACCESS_ROLES = ["client"] as const;

export function canAccessAdmin(role: UserRole): boolean {
  return hasAnyRole(role, ADMIN_ACCESS_ROLES);
}
export function canAccessOps(role: UserRole): boolean {
  return hasAnyRole(role, OPS_ACCESS_ROLES);
}
export function canAccessSupport(role: UserRole): boolean {
  return hasAnyRole(role, SUPPORT_ACCESS_ROLES);
}
export function canAccessFinance(role: UserRole): boolean {
  return hasAnyRole(role, FINANCE_ACCESS_ROLES);
}
export function canAccessRestaurant(role: UserRole): boolean {
  return hasAnyRole(role, RESTAURANT_ACCESS_ROLES);
}
export function canAccessDriver(role: UserRole): boolean {
  return hasAnyRole(role, DRIVER_ACCESS_ROLES);
}
export function canAccessClient(role: UserRole): boolean {
  return hasAnyRole(role, CLIENT_ACCESS_ROLES);
}
