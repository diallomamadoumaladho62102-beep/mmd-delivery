// Centralized role definitions for MMD Delivery

export const USER_ROLES = [
  "admin",
  "ops",
  "support",
  "finance",
  "restaurant",
  "driver",
  "client",
] as const;

export type NonNullUserRole = (typeof USER_ROLES)[number];
export type UserRole = NonNullUserRole | null;

const USER_ROLE_SET = new Set<string>(USER_ROLES);

function isKnownUserRole(value: string): value is NonNullUserRole {
  return USER_ROLE_SET.has(value);
}

export function normalizeUserRole(value: unknown): UserRole {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return isKnownUserRole(normalized) ? normalized : null;
}

export function hasAnyRole(
  role: UserRole,
  allowed: readonly NonNullUserRole[]
): boolean {
  if (role === null) {
    return false;
  }

  return allowed.includes(role);
}

// Basic role checks

export function isAdmin(role: UserRole): boolean {
  return role === "admin";
}

export function isOps(role: UserRole): boolean {
  return role === "ops";
}

export function isSupport(role: UserRole): boolean {
  return role === "support";
}

export function isFinance(role: UserRole): boolean {
  return role === "finance";
}

export function isRestaurant(role: UserRole): boolean {
  return role === "restaurant";
}

export function isDriver(role: UserRole): boolean {
  return role === "driver";
}

export function isClient(role: UserRole): boolean {
  return role === "client";
}

// Access helpers

export const ADMIN_ACCESS_ROLES = ["admin"] as const;
export const OPS_ACCESS_ROLES = ["admin", "ops"] as const;
export const SUPPORT_ACCESS_ROLES = ["admin", "support"] as const;
export const FINANCE_ACCESS_ROLES = ["admin", "finance"] as const;
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