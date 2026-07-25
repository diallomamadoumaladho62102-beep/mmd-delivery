import {
  hasPermission,
  type AdminPermission,
  type StaffRole,
} from "@/lib/adminRbac";
import type { UserRole } from "@/lib/roles";

export type StaffAccessContext = {
  role: UserRole;
  isFounder?: boolean | null;
};

/**
 * Founder never fails a permission check — absolute platform owner.
 * All other staff use role-scoped RBAC.
 */
export function sessionHasPermission(
  ctx: StaffAccessContext | null | undefined,
  permission: AdminPermission
): boolean {
  if (!ctx?.role) return false;
  if (ctx.isFounder === true) return true;
  return hasPermission(ctx.role, permission);
}

export function isFounderSession(
  ctx: StaffAccessContext | null | undefined
): boolean {
  return ctx?.isFounder === true;
}

export function dashboardPersona(
  role: StaffRole | null,
  isFounder?: boolean
): "founder" | "admin" | "ops" | "finance" | "support" | "review" | "unknown" {
  if (isFounder) return "founder";
  if (!role) return "unknown";
  if (role === "admin") return "admin";
  return role;
}
