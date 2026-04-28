import { NextRequest } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
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

function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new Error("Missing SUPABASE URL");
  return value;
}

function getSupabaseAnonKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) throw new Error("Missing SUPABASE ANON KEY");
  return value;
}

function getBearerToken(request?: NextRequest): string {
  const authHeader =
    request?.headers.get("authorization") ||
    request?.headers.get("Authorization") ||
    "";

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function createStatelessSupabaseClient() {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function getUserFromBearerToken(token: string): Promise<User> {
  if (!token) {
    throw new AdminAccessError("Auth token missing", 401);
  }

  const supabase = createStatelessSupabaseClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new AdminAccessError(error?.message || "Invalid auth session", 401);
  }

  return user;
}

async function getUserFromCookies(): Promise<User> {
  const supabase = await supabaseServer();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new AdminAccessError(error.message, 401);
  if (!user) throw new AdminAccessError("Unauthorized", 401);

  return user;
}

async function getAuthenticatedUser(request?: NextRequest): Promise<User> {
  const token = getBearerToken(request);

  if (token) {
    return getUserFromBearerToken(token);
  }

  return getUserFromCookies();
}

async function requireAuthenticatedProfile(
  request?: NextRequest
): Promise<AdminSession> {
  const user = await getAuthenticatedUser(request);
  const supabaseAdmin = buildSupabaseAdminClient();

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new AdminAccessError(error.message, 500);
  if (!profile) throw new AdminAccessError("Profile not found", 403);

  const role = normalizeRole(profile.role);
  if (!role) throw new AdminAccessError("Forbidden", 403);

  return { userId: user.id, role };
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

export async function assertAdminAccess(request?: NextRequest) {
  return assertPermission(canAccessAdminDashboard, request);
}

export async function assertCanAccessPayouts(request?: NextRequest) {
  return assertPermission(canAccessPayouts, request);
}

export async function assertCanRetryPayout(request?: NextRequest) {
  return assertPermission(canRetryPayout, request);
}

export async function assertCanReviewDrivers(request?: NextRequest) {
  return assertPermission(canReviewDrivers, request);
}

export async function assertCanReviewRestaurants(request?: NextRequest) {
  return assertPermission(canReviewRestaurants, request);
}

export async function assertCanAccessAuditLogs(request?: NextRequest) {
  return assertPermission(canAccessAuditLogs, request);
}