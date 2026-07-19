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
  | "drivers.identity.read"
  | "drivers.identity.manage"
  | "drivers.identity.settings"
  | "users.restaurants.read"
  | "users.restaurants.manage"
  | "users.sellers.read"
  | "users.sellers.manage"
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
  | "commissions.manage"
  | "subscriptions.read"
  | "subscriptions.manage"
  | "mmd_plus.read"
  | "mmd_plus.manage"
  | "marketing.read"
  | "marketing.manage"
  | "marketing.finance"
  | "marketing.support"
  | "marketing.export"
  | "analytics.read"
  | "analytics.finance"
  | "analytics.export"
  | "analytics.manage"
  | "finance.read"
  | "finance.transactions.read"
  | "finance.transactions.lookup"
  | "finance.partners.read"
  | "finance.reconciliation.manage"
  | "finance.adjustments.create"
  | "finance.adjustments.approve"
  | "finance.periods.manage"
  | "finance.reports.read"
  | "finance.export"
  | "finance.import"
  | "finance.tax.manage"
  | "finance.accounts.manage"
  | "finance.disputes.manage"
  | "finance.audit.read"
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
  | "platform_launch.read"
  | "platform_launch.manage"
  | "mmd_ai.read"
  | "mmd_ai.manage"
  | "taxi_market_metrics.read"
  | "communication.chats"
  | "communication.calls"
  | "communication.notify"
  | "loyalty.read"
  | "loyalty.manage"
  | "loyalty.restaurant.read"
  | "loyalty.restaurant.manage"
  | "loyalty.marketplace.read"
  | "loyalty.marketplace.manage"
  | "audit.read"
  | "supervision.read";

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<AdminPermission>> = {
  admin: new Set<AdminPermission>([
    "hub.access",
    "users.clients.read",
    "users.clients.manage",
    "users.drivers.read",
    "users.drivers.manage",
    "drivers.identity.read",
    "drivers.identity.manage",
    "drivers.identity.settings",
    "users.restaurants.read",
    "users.restaurants.manage",
    "users.sellers.read",
    "users.sellers.manage",
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
    "commissions.manage",
    "subscriptions.read",
    "subscriptions.manage",
    "mmd_plus.read",
    "mmd_plus.manage",
    "marketing.read",
    "marketing.manage",
    "marketing.finance",
    "marketing.support",
    "marketing.export",
    "analytics.read",
    "analytics.finance",
    "analytics.export",
    "analytics.manage",
    "finance.read",
    "finance.transactions.read",
    "finance.transactions.lookup",
    "finance.partners.read",
    "finance.reconciliation.manage",
    "finance.adjustments.create",
    "finance.adjustments.approve",
    "finance.periods.manage",
    "finance.reports.read",
    "finance.export",
    "finance.import",
    "finance.tax.manage",
    "finance.accounts.manage",
    "finance.disputes.manage",
    "finance.audit.read",
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
    "platform_launch.read",
    "platform_launch.manage",
    "mmd_ai.read",
    "mmd_ai.manage",
    "taxi_market_metrics.read",
    "communication.chats",
    "communication.calls",
    "communication.notify",
    "loyalty.read",
    "loyalty.manage",
    "loyalty.restaurant.read",
    "loyalty.restaurant.manage",
    "loyalty.marketplace.read",
    "loyalty.marketplace.manage",
    "audit.read",
    "supervision.read",
  ]),
  ops: new Set<AdminPermission>([
    "hub.access",
    "users.clients.read",
    "users.clients.manage",
    "users.drivers.read",
    "users.drivers.manage",
    "drivers.identity.read",
    "drivers.identity.manage",
    "drivers.identity.settings",
    "users.restaurants.read",
    "users.restaurants.manage",
    "users.sellers.read",
    "users.sellers.manage",
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
    "platform_launch.read",
    "mmd_ai.read",
    "taxi_market_metrics.read",
    "communication.chats",
    "communication.calls",
    "communication.notify",
    "loyalty.read",
    "loyalty.manage",
    "loyalty.restaurant.read",
    "loyalty.restaurant.manage",
    "loyalty.marketplace.read",
    "loyalty.marketplace.manage",
    "marketing.read",
    "marketing.manage",
    "marketing.support",
    "analytics.read",
    "analytics.export",
    "finance.read",
    "finance.transactions.read",
    "finance.partners.read",
    "supervision.read",
  ]),
  finance: new Set<AdminPermission>([
    "hub.access",
    "payments.read",
    "payments.sync",
    "payouts.read",
    "payouts.retry",
    "commissions.read",
    "commissions.manage",
    "subscriptions.read",
    "subscriptions.manage",
    "mmd_plus.read",
    "mmd_plus.manage",
    "marketing.read",
    "marketing.finance",
    "marketing.export",
    "analytics.read",
    "analytics.finance",
    "analytics.export",
    "analytics.manage",
    "finance.read",
    "finance.transactions.read",
    "finance.transactions.lookup",
    "finance.partners.read",
    "finance.reconciliation.manage",
    "finance.adjustments.create",
    "finance.adjustments.approve",
    "finance.periods.manage",
    "finance.reports.read",
    "finance.export",
    "finance.import",
    "finance.tax.manage",
    "finance.accounts.manage",
    "finance.disputes.manage",
    "finance.audit.read",
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
    "platform_launch.read",
    "platform_launch.manage",
    "mmd_ai.read",
    "taxi_market_metrics.read",
    "taxi_business.read",
    "taxi_business.manage",
    "loyalty.read",
    "loyalty.manage",
    "loyalty.restaurant.read",
    "loyalty.marketplace.read",
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
    "loyalty.read",
    "loyalty.restaurant.read",
    "loyalty.marketplace.read",
    "marketing.read",
    "marketing.support",
    "analytics.read",
    // Support: transaction lookup only — no global P&L / ledger / exports.
    "finance.transactions.lookup",
    "supervision.read",
  ]),
  review: new Set<AdminPermission>([
    "hub.access",
    "users.drivers.manage",
    "drivers.identity.read",
    "drivers.identity.manage",
    "users.restaurants.manage",
    "users.sellers.read",
    "users.sellers.manage",
    "finance.read",
    "finance.reports.read",
    "finance.export",
    "finance.audit.read",
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
