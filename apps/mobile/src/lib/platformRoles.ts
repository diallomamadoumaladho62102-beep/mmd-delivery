/**
 * Mobile re-export of the canonical platform roles module.
 * Keep imports pointing here (or @mmd/platform-roles) — do not redefine role lists.
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
} from "../../../../shared/platformRoles";
