import { accountStatusBlockMessage, isAccountActive } from "@/lib/accountStatus";
import { canAccessAdminDashboard } from "@/lib/adminAccess";
import { effectiveStaffRole } from "@/lib/adminRbac";
import type { UserRole } from "@/lib/roles";

export const STAFF_LOGIN_DENIED_MESSAGE =
  "Ce compte n'a pas accès à l'administration MMD Delivery.";

export type StaffLoginAccessResult =
  | { allowed: true; role: UserRole }
  | { allowed: false; message: string };

export function isValidStaffLoginEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

export function mapSupabaseSignInError(message: string): string {
  const clean = String(message ?? "").trim();
  const lower = clean.toLowerCase();

  if (!clean) return "Connexion impossible. Réessayez.";
  if (lower.includes("invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }
  if (lower.includes("email not confirmed")) {
    return "Confirmez votre adresse email avant de vous connecter.";
  }
  if (lower.includes("too many requests")) {
    return "Trop de tentatives. Patientez quelques minutes puis réessayez.";
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
      message: statusMessage ?? "Votre compte staff est suspendu ou désactivé.",
    };
  }

  if (!canAccessAdminDashboard(role)) {
    return { allowed: false, message: STAFF_LOGIN_DENIED_MESSAGE };
  }

  return { allowed: true, role };
}
