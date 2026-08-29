import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { buildEntityFinancialTimeline } from "@/lib/finance/buildEntityFinancialTimeline";
import {
  redactFinancialEventReferences,
  resolveFinancialTimelineAccess,
} from "@/lib/finance/financialTimelineAccess";
import type {
  FinancialActorRole,
  FinancialEntityType,
} from "@/lib/finance/financialTimelineTypes";
import { getProfileRole, isStaffRole } from "@/lib/taxiApi";
import type { UserRole } from "@/lib/roles";
import { isDriver, isRestaurant } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENTITY_TYPES = new Set<FinancialEntityType>([
  "taxi_ride",
  "seller_order",
  "business_account",
  "order",
  "delivery_request",
  "wallet",
]);

function resolveRole(profileRole: UserRole): FinancialActorRole {
  if (isStaffRole(profileRole)) return "admin";
  if (isDriver(profileRole)) return "driver";
  if (isRestaurant(profileRole)) return "restaurant";
  const r = String(profileRole ?? "").toLowerCase();
  if (r === "seller") return "seller";
  if (r === "business") return "business";
  return "client";
}

/**
 * Unified financial timeline — single engine, role-filtered.
 * Query: entity_type, entity_id, optional role override for admin.
 */
export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson(
      { ok: false, error: "Missing Authorization Bearer token" },
      401
    );
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const entityType = String(
    req.nextUrl.searchParams.get("entity_type") ?? ""
  ).trim() as FinancialEntityType;
  const entityId = String(
    req.nextUrl.searchParams.get("entity_id") ?? ""
  ).trim();
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 50);

  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return mmdLocationJson(
      { ok: false, error: "entity_type and entity_id are required" },
      400
    );
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const profileRole = await getProfileRole(supabaseAdmin, data.user.id);
    let role = resolveRole(profileRole);

    const requestedRole = String(
      req.nextUrl.searchParams.get("role") ?? ""
    ).trim() as FinancialActorRole;
    if (role === "admin" && requestedRole) {
      role = requestedRole;
    }

    const access = await resolveFinancialTimelineAccess({
      supabaseAdmin,
      userId: data.user.id,
      entityType,
      entityId,
      isAdmin: role === "admin",
    });
    if (access.ok === false) {
      return mmdLocationJson({ ok: false, error: access.error }, access.status);
    }
    if (role !== "admin") {
      role = access.role;
    }

    const events = redactFinancialEventReferences(
      await buildEntityFinancialTimeline(supabaseAdmin, {
        entityType,
        entityId,
        role,
        limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      }),
      role
    );

    return mmdLocationJson({
      ok: true,
      entity_type: entityType,
      entity_id: entityId,
      role,
      events,
    });
  } catch (e) {
    return mmdLocationJson(
      {
        ok: false,
        error: e instanceof Error ? e.message : "timeline_failed",
      },
      500
    );
  }
}
