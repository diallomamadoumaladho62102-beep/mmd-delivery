import {
  hasPermission,
  isStaffRole,
  isSuperAdmin,
  type AdminPermission,
} from "@/lib/adminRbac";
import { type UserRole } from "@/lib/roles";

/**
 * Centralized admin authorization — RBAC staff roles.
 * `admin` = Super Admin (founder).
 */

export function canAccessAdminDashboard(role: UserRole | null): boolean {
  return isStaffRole(role) && hasPermission(role, "hub.access");
}

export function canManageClients(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "users.clients.manage");
}

export function canAccessPayouts(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "payouts.read");
}

export function canRetryPayout(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "payouts.retry");
}

export function canViewDrivers(role: UserRole | null): boolean {
  if (!role) return false;
  return (
    hasPermission(role, "users.drivers.read") ||
    hasPermission(role, "users.drivers.manage")
  );
}

export function canReviewDrivers(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "users.drivers.manage");
}

export function canViewRestaurants(role: UserRole | null): boolean {
  if (!role) return false;
  return (
    hasPermission(role, "users.restaurants.read") ||
    hasPermission(role, "users.restaurants.manage")
  );
}

export function canReviewRestaurants(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "users.restaurants.manage");
}

export function canAccessAuditLogs(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "audit.read");
}

export function canManageAdmins(role: UserRole | null): boolean {
  return isSuperAdmin(role);
}

export function canModifyPricing(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "pricing.write");
}

export function canReadPricing(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "pricing.read");
}

export function canAccessStripeMonitoring(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "payments.read");
}

export function canManageDispatch(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "dispatch.manage");
}

export function canAccessCommunication(role: UserRole | null): boolean {
  if (!role) return false;
  return (
    hasPermission(role, "communication.chats") ||
    hasPermission(role, "communication.calls")
  );
}

export function canManageOrders(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "orders.manage");
}

export function canManageDeliveryRequests(role: UserRole | null): boolean {
  if (!role) return false;
  return hasPermission(role, "delivery_requests.manage");
}

export function staffHasPermission(
  role: UserRole | null,
  permission: AdminPermission
): boolean {
  if (!role) return false;
  return hasPermission(role, permission);
}
