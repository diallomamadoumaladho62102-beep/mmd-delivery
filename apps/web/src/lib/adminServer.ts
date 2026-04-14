import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

function getSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new Error("Missing SUPABASE URL");
  return value;
}

function getSupabaseAnonKey() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) throw new Error("Missing SUPABASE ANON KEY");
  return value;
}

async function getUserFromRequest(request?: NextRequest) {
  // 🔥 PRIORITÉ : Authorization header (Bearer token)
  const authHeader = request?.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : "";

  if (token) {
    const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new AdminAccessError("Auth session missing!", 401);
    }

    return user;
  }

  // 🔥 FALLBACK : cookies (SSR)
  const supabase = await supabaseServer();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new AdminAccessError(error.message, 401);
  }

  if (!user) {
    throw new AdminAccessError("Unauthorized", 401);
  }

  return user;
}

async function requireAuthenticatedProfile(
  request?: NextRequest
): Promise<AdminSession> {
  const user = await getUserFromRequest(request);

  const supabase = await supabaseServer();

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
  checker: (role: UserRole) => boolean,
  request?: NextRequest
): Promise<AdminSession> {
  const session = await requireAuthenticatedProfile(request);

  if (!checker(session.role)) {
    throw new AdminAccessError("Forbidden", 403);
  }

  return session;
}

export async function assertAdminAccess(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canAccessAdminDashboard, request);
}

export async function assertCanAccessPayouts(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canAccessPayouts, request);
}

export async function assertCanRetryPayout(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canRetryPayout, request);
}

export async function assertCanReviewDrivers(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canReviewDrivers, request);
}

export async function assertCanReviewRestaurants(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canReviewRestaurants, request);
}

export async function assertCanAccessAuditLogs(
  request?: NextRequest
): Promise<AdminSession> {
  return assertPermission(canAccessAuditLogs, request);
}