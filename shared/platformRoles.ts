/**
 * SINGLE SOURCE OF TRUTH for `profiles.role` across Web, Mobile, API, and SQL.
 *
 * Rules:
 * - Persist only canonical snake_case values from PROFILE_ROLES.
 * - Never persist display labels ("Operations Admin").
 * - Use normalizeProfileRole() at every write/read boundary.
 * - Adding a role: append here, then regenerate/extend the SQL migration CHECK.
 */

/**
 * Roles that may be *stored* in public.profiles.role (canonical only).
 * Legacy aliases (admin/ops/customer/…) are accepted on input via
 * normalizeProfileRole() but are never persisted.
 */
export const PROFILE_ROLES = [
  // Customer / public
  "client",
  "driver",
  // Restaurant
  "restaurant",
  "restaurant_manager",
  "restaurant_staff",
  // Marketplace
  "seller",
  "merchant_manager",
  "merchant_staff",
  // Business / taxi business
  "business_owner",
  "business_manager",
  // Administration
  "super_admin",
  "operations_admin",
  "finance_admin",
  "support_admin",
  "review_admin",
  // Platform
  "developer",
  "system",
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

/** Public signup / app surface roles (normalized storage). */
export const PUBLIC_ROLES = [
  "client",
  "driver",
  "restaurant",
  "seller",
] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

/** Staff roles persisted going forward (canonical). */
export const STAFF_ROLES = [
  "super_admin",
  "operations_admin",
  "finance_admin",
  "support_admin",
  "review_admin",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Super-admin persona (founder flag also grants this). */
export const SUPER_ADMIN_ROLE: StaffRole = "super_admin";

/** Roles creatable from Admin → Staff UI (not super_admin). */
export const CREATABLE_STAFF_ROLES = STAFF_ROLES.filter(
  (r) => r !== "super_admin",
) as readonly Exclude<StaffRole, "super_admin">[];

const PROFILE_ROLE_SET = new Set<string>(PROFILE_ROLES);
const STAFF_ROLE_SET = new Set<string>(STAFF_ROLES);
const PUBLIC_ROLE_SET = new Set<string>(PUBLIC_ROLES);

/** Map any known alias / legacy / label-ish value → canonical PROFILE_ROLES value. */
const ROLE_ALIASES: Record<string, ProfileRole> = {
  // public
  customer: "client",
  client: "client",
  driver: "driver",
  livreur: "driver",
  chauffeur: "driver",
  restaurant: "restaurant",
  restaurant_owner: "restaurant",
  restaurantowner: "restaurant",
  "restaurant-owner": "restaurant",
  restaurant_manager: "restaurant_manager",
  restaurant_staff: "restaurant_staff",
  seller: "seller",
  merchant: "seller",
  merchant_owner: "seller",
  vendeur: "seller",
  merchant_manager: "merchant_manager",
  merchant_staff: "merchant_staff",
  business_owner: "business_owner",
  business_manager: "business_manager",
  // staff long form (+ founder flag role stored as super_admin)
  founder: "super_admin",
  super_admin: "super_admin",
  superadmin: "super_admin",
  "super-admin": "super_admin",
  operations_admin: "operations_admin",
  operationsadmin: "operations_admin",
  "operations-admin": "operations_admin",
  finance_admin: "finance_admin",
  financeadmin: "finance_admin",
  "finance-admin": "finance_admin",
  support_admin: "support_admin",
  supportadmin: "support_admin",
  "support-admin": "support_admin",
  review_admin: "review_admin",
  reviewadmin: "review_admin",
  "review-admin": "review_admin",
  // legacy short staff → canonical long
  admin: "super_admin",
  ops: "operations_admin",
  finance: "finance_admin",
  support: "support_admin",
  review: "review_admin",
  // platform
  developer: "developer",
  system: "system",
};

function stripRoleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "_")
    .replace(/-+/g, "_");
}

export function isProfileRole(value: unknown): value is ProfileRole {
  return typeof value === "string" && PROFILE_ROLE_SET.has(value);
}

export function isStaffRole(value: unknown): value is StaffRole {
  if (typeof value !== "string") return false;
  const canonical = normalizeProfileRole(value);
  return canonical !== null && STAFF_ROLE_SET.has(canonical);
}

export function isPublicRole(value: unknown): value is PublicRole {
  if (typeof value !== "string") return false;
  const canonical = normalizeProfileRole(value);
  return canonical !== null && PUBLIC_ROLE_SET.has(canonical);
}

/**
 * Normalize any inbound role (UI label, alias, legacy short name) to a
 * canonical ProfileRole. Returns null if unknown.
 */
export function normalizeProfileRole(value: unknown): ProfileRole | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const key = stripRoleKey(raw);
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  if (PROFILE_ROLE_SET.has(key)) return key as ProfileRole;

  // Soft match display labels → canonical
  const compact = key.replace(/_/g, "");
  const labelMap: Record<string, ProfileRole> = {
    operationsadmin: "operations_admin",
    financeadmin: "finance_admin",
    supportadmin: "support_admin",
    reviewadmin: "review_admin",
    superadmin: "super_admin",
    fondateur: "super_admin",
    restaurantowner: "restaurant",
  };
  if (labelMap[compact]) return labelMap[compact];

  return null;
}

export function normalizeStaffRole(value: unknown): StaffRole | null {
  const role = normalizeProfileRole(value);
  if (!role) return null;
  return STAFF_ROLE_SET.has(role) ? (role as StaffRole) : null;
}

export function roleDisplayName(
  role: string | null | undefined,
  opts?: { isFounder?: boolean | null },
): string {
  if (opts?.isFounder === true) return "Fondateur";
  const canonical = normalizeProfileRole(role) ?? role;
  switch (canonical) {
    case "super_admin":
      return "Super Admin";
    case "operations_admin":
      return "Operations Admin";
    case "finance_admin":
      return "Finance Admin";
    case "support_admin":
      return "Support Admin";
    case "review_admin":
      return "Review Admin";
    case "client":
      return "Client";
    case "driver":
      return "Driver";
    case "restaurant":
      return "Restaurant";
    case "seller":
      return "Seller";
    case "developer":
      return "Developer";
    case "system":
      return "System";
    default:
      return canonical ?? "—";
  }
}

/** SQL CHECK list (single place to copy into migrations). */
export const PROFILE_ROLES_SQL_LIST = PROFILE_ROLES.map((r) => `'${r}'`).join(
  ", ",
);

/** Staff roles for SQL helpers (long + legacy short during transition). */
export const STAFF_ROLES_SQL_LIST = [
  ...STAFF_ROLES,
  "admin",
  "ops",
  "finance",
  "support",
  "review",
  "founder",
]
  .map((r) => `'${r}'`)
  .join(", ");
