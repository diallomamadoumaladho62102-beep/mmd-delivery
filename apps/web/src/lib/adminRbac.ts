import { normalizeUserRole, type UserRole } from "@/lib/roles";

/** Founder / super admin — `profiles.role = 'admin'` */
export const SUPER_ADMIN_ROLE = "admin" as const;

export const STAFF_ROLES = [
  "admin",
  "ops",
  "finance",
  "support",
  "review",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type AdminPermission =
  | "hub.access"
  | "users.clients.read"
  | "users.clients.manage"
  | "users.drivers.read"
  | "users.drivers.manage"
  | "users.restaurants.read"
  | "users.restaurants.manage"
  | "users.admins.manage"
  | "orders.read"
  | "orders.manage"
  | "delivery_requests.read"
  | "delivery_requests.manage"
  | "driver_offers.read"
  | "dispatch.read"
  | "dispatch.manage"
  | "payments.read"
  | "payments.sync"
  | "payouts.read"
  | "payouts.retry"
  | "commissions.read"
  | "pricing.read"
  | "pricing.write"
  | "taxi_rides.read"
  | "taxi_rides.manage"
  | "taxi_pricing.read"
  | "taxi_pricing.write"
  | "taxi_drivers.read"
  | "taxi_drivers.manage"
  | "taxi_payouts.read"
  | "taxi_payouts.manage"
  | "taxi_promotions.read"
  | "taxi_promotions.manage"
  | "taxi_shared_rides.read"
  | "taxi_shared_rides.manage"
  | "taxi_business.read"
  | "taxi_business.manage"
  | "taxi_driver_quality.read"
  | "taxi_driver_quality.manage"
  | "taxi_exchange_rates.read"
  | "taxi_exchange_rates.manage"
  | "taxi_taxes.read"
  | "taxi_taxes.manage"
  | "taxi_countries.read"
  | "taxi_countries.manage"
  | "taxi_monitoring.read"
  | "taxi_alerts.read"
  | "taxi_alerts.manage"
  | "taxi_launch.read"
  | "taxi_launch.manage"
  | "taxi_market_metrics.read"
  | "communication.chats"
  | "communication.calls"
  | "communication.notify"
  | "audit.read"
  | "supervision.read";

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<AdminPermission>> = {
  admin: new Set<AdminPermission>([
    "hub.access",
    "users.clients.read",
    "users.clients.manage",
    "users.drivers.read",
    "users.drivers.manage",
    "users.restaurants.read",
    "users.restaurants.manage",
    "users.admins.manage",
    "orders.read",
    "orders.manage",
    "delivery_requests.read",
    "delivery_requests.manage",
    "driver_offers.read",
    "dispatch.read",
    "dispatch.manage",
    "payments.read",
    "payments.sync",
    "payouts.read",
    "payouts.retry",
    "commissions.read",
    "pricing.read",
    "pricing.write",
    "taxi_rides.read",
    "taxi_rides.manage",
    "taxi_pricing.read",
    "taxi_pricing.write",
    "taxi_drivers.read",
    "taxi_drivers.manage",
    "taxi_payouts.read",
    "taxi_payouts.manage",
    "taxi_promotions.read",
    "taxi_promotions.manage",
    "taxi_shared_rides.read",
    "taxi_shared_rides.manage",
    "taxi_business.read",
    "taxi_business.manage",
    "taxi_driver_quality.read",
    "taxi_driver_quality.manage",
    "taxi_exchange_rates.read",
    "taxi_exchange_rates.manage",
    "taxi_taxes.read",
    "taxi_taxes.manage",
    "taxi_countries.read",
    "taxi_countries.manage",
    "taxi_monitoring.read",
    "taxi_alerts.read",
    "taxi_alerts.manage",
    "taxi_launch.read",
    "taxi_launch.manage",
    "taxi_market_metrics.read",
    "communication.chats",
    "communication.calls",
    "communication.notify",
    "audit.read",
    "supervision.read",
  ]),
  ops: new Set<AdminPermission>([
    "hub.access",
    "users.clients.read",
    "users.clients.manage",
    "users.drivers.read",
    "users.drivers.manage",
    "users.restaurants.read",
    "users.restaurants.manage",
    "orders.read",
    "orders.manage",
    "delivery_requests.read",
    "delivery_requests.manage",
    "driver_offers.read",
    "dispatch.read",
    "dispatch.manage",
    "taxi_rides.read",
    "taxi_rides.manage",
    "taxi_drivers.read",
    "taxi_drivers.manage",
    "taxi_promotions.read",
    "taxi_shared_rides.read",
    "taxi_shared_rides.manage",
    "taxi_business.read",
    "taxi_driver_quality.read",
    "taxi_monitoring.read",
    "taxi_alerts.read",
    "taxi_alerts.manage",
    "taxi_launch.read",
    "taxi_market_metrics.read",
    "communication.chats",
    "communication.calls",
    "communication.notify",
    "supervision.read",
  ]),
  finance: new Set<AdminPermission>([
    "hub.access",
    "payments.read",
    "payments.sync",
    "payouts.read",
    "payouts.retry",
    "commissions.read",
    "taxi_pricing.read",
    "taxi_payouts.read",
    "taxi_payouts.manage",
    "taxi_promotions.read",
    "taxi_exchange_rates.read",
    "taxi_exchange_rates.manage",
    "taxi_taxes.read",
    "taxi_taxes.manage",
    "taxi_countries.read",
    "taxi_countries.manage",
    "taxi_monitoring.read",
    "taxi_alerts.read",
    "taxi_launch.read",
    "taxi_launch.manage",
    "taxi_market_metrics.read",
    "taxi_business.read",
    "taxi_business.manage",
    "audit.read",
    "supervision.read",
  ]),
  support: new Set<AdminPermission>([
    "hub.access",
    "users.clients.read",
    "users.drivers.read",
    "users.restaurants.read",
    "orders.read",
    "taxi_rides.read",
    "taxi_shared_rides.read",
    "taxi_business.read",
    "communication.chats",
    "communication.calls",
    "communication.notify",
    "supervision.read",
  ]),
  review: new Set<AdminPermission>([
    "hub.access",
    "users.drivers.manage",
    "users.restaurants.manage",
  ]),
};

export function isStaffRole(role: UserRole): role is StaffRole {
  if (!role) return false;
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function isSuperAdmin(role: UserRole): boolean {
  return role === SUPER_ADMIN_ROLE;
}

export function canStaffAccessHub(role: UserRole): boolean {
  return isStaffRole(role) && hasPermission(role, "hub.access");
}

export function hasPermission(
  role: UserRole,
  permission: AdminPermission
): boolean {
  if (!role || !isStaffRole(role)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function getStaffPermissions(role: UserRole): AdminPermission[] {
  if (!role || !isStaffRole(role)) return [];
  return Array.from(ROLE_PERMISSIONS[role]);
}

export function roleDisplayName(role: UserRole): string {
  switch (role) {
    case "admin":
      return "Super Admin (Fondateur)";
    case "ops":
      return "Operations Admin";
    case "finance":
      return "Finance Admin";
    case "support":
      return "Support Admin";
    case "review":
      return "Review Admin";
    default:
      return role ?? "—";
  }
}

export function normalizeStaffRole(value: unknown): StaffRole | null {
  const role = normalizeUserRole(value);
  return isStaffRole(role) ? role : null;
}
