import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { buildEntityFinancialTimeline } from "@/lib/finance/buildEntityFinancialTimeline";
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

    // Entity access checks for non-admin
    if (role !== "admin") {
      if (entityType === "taxi_ride") {
        const { data: ride } = await supabaseAdmin
          .from("taxi_rides")
          .select("client_user_id, driver_id")
          .eq("id", entityId)
          .maybeSingle();
        if (!ride) {
          return mmdLocationJson({ ok: false, error: "Not found" }, 404);
        }
        const uid = data.user.id;
        const isClient = String(ride.client_user_id) === uid;
        const isDriver = String(ride.driver_id ?? "") === uid;
        if (!isClient && !isDriver) {
          return mmdLocationJson({ ok: false, error: "Forbidden" }, 403);
        }
        role = isDriver ? "driver" : "client";
      } else if (entityType === "business_account") {
        const { data: member } = await supabaseAdmin
          .from("taxi_business_members")
          .select("id")
          .eq("business_account_id", entityId)
          .eq("user_id", data.user.id)
          .eq("active", true)
          .maybeSingle();
        if (!member) {
          return mmdLocationJson({ ok: false, error: "Forbidden" }, 403);
        }
        role = "business";
      } else if (entityType === "seller_order") {
        const { data: order } = await supabaseAdmin
          .from("seller_orders")
          .select("client_user_id, seller_id")
          .eq("id", entityId)
          .maybeSingle();
        if (!order) {
          return mmdLocationJson({ ok: false, error: "Not found" }, 404);
        }
        const uid = data.user.id;
        if (String(order.client_user_id) === uid) role = "client";
        else {
          const { data: seller } = await supabaseAdmin
            .from("sellers")
            .select("id")
            .eq("id", order.seller_id)
            .or(`user_id.eq.${uid},owner_user_id.eq.${uid}`)
            .maybeSingle();
          if (!seller) {
            return mmdLocationJson({ ok: false, error: "Forbidden" }, 403);
          }
          role = "seller";
        }
      }
    }

    const events = await buildEntityFinancialTimeline(supabaseAdmin, {
      entityType,
      entityId,
      role,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
    });

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
