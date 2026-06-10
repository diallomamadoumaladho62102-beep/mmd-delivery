import { NextRequest } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isAccountActive } from "@/lib/accountStatus";
import {
  canAccessAdminDashboard,
  canAccessAuditLogs,
  canAccessCommunication,
  canAccessPayouts,
  canAccessStripeMonitoring,
  canManageAdmins,
  canManageClients,
  canManageDeliveryRequests,
  canManageDispatch,
  canManageOrders,
  canModifyPricing,
  canReadPricing,
  canReviewDrivers,
  canReviewRestaurants,
  canReviewSellers,
  canRetryPayout,
  staffHasPermission,
} from "@/lib/adminAccess";
import { isStaffRole } from "@/lib/adminRbac";
import type { AdminPermission } from "@/lib/adminRbac";
import { type UserRole } from "@/lib/roles";

export type AdminSession = {
  userId: string;
  role: UserRole;
  accountStatus: string;
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

export async function resolveAdminSession(
  request?: NextRequest
): Promise<AdminSession> {
  const user = await getAuthenticatedUser(request);
  const supabaseAdmin = buildSupabaseAdminClient();

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, role, account_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new AdminAccessError(error.message, 500);
  if (!profile) throw new AdminAccessError("Profile not found", 403);

  const role = normalizeRole(profile.role);
  if (!role) throw new AdminAccessError("Forbidden", 403);

  const accountStatus = String(profile.account_status ?? "active");

  if (isStaffRole(role) && !isAccountActive(accountStatus)) {
    throw new AdminAccessError("Staff account is suspended or disabled", 403);
  }

  if (!isAccountActive(accountStatus) && !isStaffRole(role)) {
    throw new AdminAccessError("Account is suspended or disabled", 403);
  }

  return { userId: user.id, role, accountStatus };
}

async function assertPermission(
  checker: (role: UserRole) => boolean,
  request?: NextRequest
): Promise<AdminSession> {
  const session = await resolveAdminSession(request);

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

export async function assertCanReviewSellers(request?: NextRequest) {
  return assertPermission(canReviewSellers, request);
}

export async function assertCanAccessAuditLogs(request?: NextRequest) {
  return assertPermission(canAccessAuditLogs, request);
}

export async function assertCanModifyPricing(request?: NextRequest) {
  return assertPermission(canModifyPricing, request);
}

export async function assertCanReadPricing(request?: NextRequest) {
  return assertPermission(canReadPricing, request);
}

export async function assertCanManageAdmins(request?: NextRequest) {
  return assertPermission(canManageAdmins, request);
}

export async function assertStaffPermission(
  permission: AdminPermission,
  request?: NextRequest
) {
  return assertPermission(
    (role) => staffHasPermission(role, permission),
    request
  );
}

export async function assertCanAccessStripeMonitoring(
  request?: NextRequest
) {
  return assertPermission(canAccessStripeMonitoring, request);
}

export async function assertCanManageDispatch(request?: NextRequest) {
  return assertPermission(canManageDispatch, request);
}

export async function assertCanAccessCommunication(request?: NextRequest) {
  return assertPermission(canAccessCommunication, request);
}

export async function assertCanManageClients(request?: NextRequest) {
  return assertPermission(canManageClients, request);
}

export async function assertCanManageOrders(request?: NextRequest) {
  return assertPermission(canManageOrders, request);
}

export async function assertCanManageDeliveryRequests(request?: NextRequest) {
  return assertPermission(canManageDeliveryRequests, request);
}

export async function assertCanSendCommunication(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "communication.notify"),
    request
  );
}

export async function assertCanManageTaxiRides(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_rides.manage"),
    request
  );
}

export async function assertCanWriteTaxiPricing(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_pricing.write"),
    request
  );
}

export async function assertCanManageTaxiDrivers(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_drivers.manage"),
    request
  );
}

export async function assertCanManageTaxiPayouts(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_payouts.manage"),
    request
  );
}

export async function assertCanManageTaxiPromotions(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_promotions.manage"),
    request
  );
}

export async function assertCanManageTaxiExchangeRates(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_exchange_rates.manage"),
    request
  );
}

export async function assertCanManageTaxiTaxes(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_taxes.manage"),
    request
  );
}

export async function assertCanManageTaxiCountries(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_countries.manage"),
    request
  );
}

export async function assertCanManageTaxiAlerts(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_alerts.manage"),
    request
  );
}

export async function assertCanManageTaxiLaunch(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "taxi_launch.manage"),
    request
  );
}

export async function assertCanManagePlatformLaunch(request?: NextRequest) {
  return assertPermission(
    (role) => staffHasPermission(role, "platform_launch.manage"),
    request
  );
}