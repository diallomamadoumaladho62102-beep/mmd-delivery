import type { UserRole } from "@/lib/roles";
import {
  CREATABLE_STAFF_ROLES,
  STAFF_ROLES,
  SUPER_ADMIN_ROLE,
  normalizeStaffRole as normalizeCanonicalStaffRole,
  roleDisplayName as canonicalRoleDisplayName,
  type StaffRole,
} from "@mmd/platform-roles";

export {
  CREATABLE_STAFF_ROLES,
  STAFF_ROLES,
  SUPER_ADMIN_ROLE,
  type StaffRole,
};

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
  | "supervision.read"
  | "test_records.read";

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<AdminPermission>> = {
  super_admin: new Set<AdminPermission>([
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
    "test_records.read",
  ]),
  operations_admin: new Set<AdminPermission>([
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
  finance_admin: new Set<AdminPermission>([
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
  support_admin: new Set<AdminPermission>([
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
  review_admin: new Set<AdminPermission>([
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
  return normalizeCanonicalStaffRole(role) !== null;
}

export function isSuperAdmin(role: UserRole): boolean {
  return normalizeCanonicalStaffRole(role) === SUPER_ADMIN_ROLE;
}

/**
 * Founder flag is the durable Super Admin signal. Even if profiles.role was
 * incorrectly demoted (e.g. to restaurant), is_founder still grants admin.
 */
export function effectiveStaffRole(params: {
  role: unknown;
  isFounder?: boolean | null;
}): StaffRole | null {
  if (params.isFounder === true) return SUPER_ADMIN_ROLE;
  return normalizeCanonicalStaffRole(params.role);
}

export function canStaffAccessHub(role: UserRole): boolean {
  const staff = normalizeCanonicalStaffRole(role);
  return !!staff && ROLE_PERMISSIONS[staff].has("hub.access");
}

export function hasPermission(
  role: UserRole,
  permission: AdminPermission
): boolean {
  const staff = normalizeCanonicalStaffRole(role);
  if (!staff) return false;
  return ROLE_PERMISSIONS[staff].has(permission);
}

export function getStaffPermissions(role: UserRole): AdminPermission[] {
  const staff = normalizeCanonicalStaffRole(role);
  if (!staff) return [];
  return Array.from(ROLE_PERMISSIONS[staff]);
}

export function roleDisplayName(
  role: UserRole,
  opts?: { isFounder?: boolean | null }
): string {
  return canonicalRoleDisplayName(role, opts);
}

export function normalizeStaffRole(value: unknown): StaffRole | null {
  return normalizeCanonicalStaffRole(value);
}
