import { accountStatusBlockMessage, isAccountActive } from "@/lib/accountStatus";
import { canAccessAdminDashboard } from "@/lib/adminAccess";
import { effectiveStaffRole } from "@/lib/adminRbac";
import type { UserRole } from "@/lib/roles";

export const STAFF_LOGIN_DENIED_MESSAGE =
  "This account does not have access to MMD Delivery administration.";

export type StaffLoginAccessResult =
  | { allowed: true; role: UserRole }
  | { allowed: false; message: string };

export function isValidStaffLoginEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

export function mapSupabaseSignInError(message: string): string {
  const clean = String(message ?? "").trim();
  const lower = clean.toLowerCase();

  if (!clean) return "Unable to sign in. Please try again.";
  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }
  if (lower.includes("too many requests")) {
    return "Too many attempts. Wait a few minutes and try again.";
  }

  return clean;
}

export function evaluateStaffLoginAccess(params: {
  role: unknown;
  accountStatus?: unknown;
  isFounder?: boolean | null;
}): StaffLoginAccessResult {
  const role = effectiveStaffRole({
    role: params.role,
    isFounder: params.isFounder,
  });

  if (!role) {
    return { allowed: false, message: STAFF_LOGIN_DENIED_MESSAGE };
  }

  const accountStatus =
    typeof params.accountStatus === "string" ? params.accountStatus : null;
  const statusMessage = accountStatusBlockMessage(accountStatus);
  if (!isAccountActive(accountStatus)) {
    return {
      allowed: false,
      message: statusMessage ?? "Your staff account is suspended or disabled.",
    };
  }

  if (!canAccessAdminDashboard(role)) {
    return { allowed: false, message: STAFF_LOGIN_DENIED_MESSAGE };
  }

  return { allowed: true, role };
}
