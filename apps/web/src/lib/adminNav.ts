import type { AdminPermission } from "@/lib/adminRbac";
import type { StaffRole } from "@/lib/adminRbac";

export type AdminNavItem = {
  href: string;
  label: string;
  permission: AdminPermission;
  /** Optional: only show for these roles (Founder always sees all). */
  roles?: readonly StaffRole[];
};

export type AdminNavGroup = {
  id: string;
  label: string;
  items: readonly AdminNavItem[];
};

/**
 * Enterprise Control Center IA — Stripe-style grouped sidebar.
 * Items are filtered by RBAC; Founder bypasses all filters.
 */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      { href: "/admin", label: "Overview", permission: "hub.access" },
      {
        href: "/admin/hr",
        label: "People Ops",
        permission: "users.admins.manage",
        roles: ["super_admin"],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders", permission: "orders.read" },
      { href: "/admin/dispatch", label: "Dispatch", permission: "dispatch.read" },
      {
        href: "/admin/driver-offers",
        label: "Driver Offers",
        permission: "driver_offers.read",
      },
      {
        href: "/admin/driver-opportunities",
        label: "Driver Opportunities",
        permission: "users.drivers.manage",
      },
      {
        href: "/admin/delivery-requests",
        label: "Delivery Requests",
        permission: "delivery_requests.read",
      },
      { href: "/admin/taxi-rides", label: "Taxi", permission: "taxi_rides.read" },
      {
        href: "/admin/live-map",
        label: "Live Map",
        permission: "supervision.read",
      },
      {
        href: "/admin/supervision",
        label: "Supervision",
        permission: "supervision.read",
      },
    ],
  },
  {
    id: "partners",
    label: "Partners",
    items: [
      { href: "/admin/clients", label: "Customers", permission: "users.clients.read" },
      { href: "/admin/drivers", label: "Drivers", permission: "users.drivers.read" },
      {
        href: "/admin/driver-identity",
        label: "Driver Identity",
        permission: "drivers.identity.read",
      },
      {
        href: "/admin/identity",
        label: "Stripe Identity",
        permission: "drivers.identity.read",
      },
      {
        href: "/admin/restaurants",
        label: "Restaurants",
        permission: "users.restaurants.read",
      },
      { href: "/admin/sellers", label: "Sellers", permission: "users.sellers.read" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { href: "/admin/finance", label: "Finance Hub", permission: "finance.read" },
      { href: "/admin/stripe", label: "Payments", permission: "payments.read" },
      { href: "/admin/payouts", label: "Payouts", permission: "payouts.read" },
      {
        href: "/admin/commission-engine",
        label: "Commissions",
        permission: "commissions.read",
      },
      { href: "/admin/pricing", label: "Pricing", permission: "pricing.read" },
      { href: "/admin/loyalty", label: "Loyalty", permission: "loyalty.read" },
    ],
  },
  {
    id: "safety",
    label: "Safety",
    items: [
      {
        href: "/admin/road-safety",
        label: "Road Safety",
        permission: "taxi_drivers.read",
      },
      {
        href: "/admin/ride-safety-recording-rules",
        label: "Recordings",
        permission: "taxi_drivers.read",
      },
      { href: "/admin/audit", label: "Audit", permission: "audit.read" },
    ],
  },
  {
    id: "support",
    label: "Support",
    items: [
      { href: "/admin/chats", label: "Chats", permission: "communication.chats" },
      { href: "/admin/calls", label: "Calls", permission: "communication.calls" },
      {
        href: "/admin/communication",
        label: "Notify",
        permission: "communication.notify",
      },
    ],
  },
  {
    id: "launch",
    label: "Launch",
    items: [
      {
        href: "/admin/platform-launch",
        label: "Platform",
        permission: "platform_launch.read",
      },
      {
        href: "/admin/county-management",
        label: "Counties",
        permission: "platform_launch.read",
      },
      {
        href: "/admin/taxi-countries",
        label: "Countries",
        permission: "taxi_countries.read",
      },
      {
        href: "/admin/taxi-launch",
        label: "Taxi Launch",
        permission: "taxi_launch.read",
      },
    ],
  },
  {
    id: "ai",
    label: "MMD AI",
    items: [
      { href: "/admin/mmd-ai", label: "Overview", permission: "mmd_ai.read" },
      {
        href: "/admin/mmd-ai/launch",
        label: "Launch Control",
        permission: "mmd_ai.read",
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        href: "/admin/staff",
        label: "Administrators",
        permission: "users.admins.manage",
      },
      {
        href: "/admin/teams",
        label: "Teams & Organization",
        permission: "users.admins.manage",
      },
      {
        href: "/admin/tasks",
        label: "Tasks",
        permission: "hub.access",
      },
      {
        href: "/admin/analytics",
        label: "Analytics",
        permission: "analytics.read",
      },
      {
        href: "/admin/marketing",
        label: "Marketing",
        permission: "marketing.read",
      },
      {
        href: "/admin/advertisements",
        label: "Advertisements",
        permission: "marketing.read",
      },
      {
        href: "/admin/site",
        label: "Corporate Website",
        permission: "marketing.read",
      },
      {
        href: "/admin/test-records",
        label: "Test Records",
        permission: "test_records.read",
      },
    ],
  },
] as const;

export function filterNavGroups(params: {
  role: StaffRole | null;
  isFounder?: boolean;
  hasPermission: (permission: AdminPermission) => boolean;
}): AdminNavGroup[] {
  const { role, isFounder, hasPermission } = params;
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (isFounder) return true;
      if (!hasPermission(item.permission)) return false;
      if (item.roles && role && !item.roles.includes(role)) return false;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
}
