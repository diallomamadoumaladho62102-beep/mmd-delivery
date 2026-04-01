import { supabaseServer } from "@/lib/supabaseServer";
import {
  canAccessAdminDashboard,
  canAccessAuditLogs,
  canAccessPayouts,
  canReviewDrivers,
  canReviewRestaurants,
  canRetryPayout,
} from "@/lib/adminAccess";
import { type UserRole } from "@/lib/roles";

export type AdminSession = {
  userId: string;
  role: UserRole;
};

export class AdminAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AdminAccessError";
    this.status = status;
  }
}

function normalizeRole(value: unknown): UserRole | null {
  return typeof value === "string" && value.trim().length > 0
    ? (value as UserRole)
    : null;
}

async function requireAuthenticatedProfile(): Promise<AdminSession> {
  const supabase = await supabaseServer();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new AdminAccessError(userError.message, 401);
  }

  if (!user) {
    throw new AdminAccessError("Unauthorized", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new AdminAccessError(profileError.message, 500);
  }

  if (!profile) {
    throw new AdminAccessError("Profile not found", 403);
  }

  if (profile.id !== user.id) {
    throw new AdminAccessError("Forbidden", 403);
  }

  const role = normalizeRole(profile.role);

  if (!role) {
    throw new AdminAccessError("Forbidden", 403);
  }

  return {
    userId: user.id,
    role,
  };
}

async function assertPermission(
  checker: (role: UserRole) => boolean
): Promise<AdminSession> {
  const session = await requireAuthenticatedProfile();

  if (!checker(session.role)) {
    throw new AdminAccessError("Forbidden", 403);
  }

  return session;
}

export async function assertAdminAccess(): Promise<AdminSession> {
  return assertPermission(canAccessAdminDashboard);
}

export async function assertCanAccessPayouts(): Promise<AdminSession> {
  return assertPermission(canAccessPayouts);
}

export async function assertCanRetryPayout(): Promise<AdminSession> {
  return assertPermission(canRetryPayout);
}

export async function assertCanReviewDrivers(): Promise<AdminSession> {
  return assertPermission(canReviewDrivers);
}

export async function assertCanReviewRestaurants(): Promise<AdminSession> {
  return assertPermission(canReviewRestaurants);
}

export async function assertCanAccessAuditLogs(): Promise<AdminSession> {
  return assertPermission(canAccessAuditLogs);
}