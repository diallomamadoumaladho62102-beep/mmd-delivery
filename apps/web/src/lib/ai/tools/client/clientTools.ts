import type { AiToolContext, AiToolResult } from "@/lib/ai/aiTypes";
import { buildSharedMissionContext } from "@/lib/ai/contexts/buildSharedMissionContext";
import { explainOrderStatus } from "@/lib/ai/tools/shared/explainOrderStatus";
import { getSupportContactInfo } from "@/lib/ai/tools/shared/getSupportContactInfo";
import { resolveClientPlatformScope, resolvePlatformScopeFeatures } from "@/lib/platformScopeResolver";

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function assertClientOwnsOrder(
  ctx: AiToolContext,
  orderId: string
): Promise<{ ok: true } | { ok: false; summary: string }> {
  const mission = await buildSharedMissionContext({
    supabaseAdmin: ctx.supabaseAdmin,
    userId: ctx.userId,
    viewerRole: "client",
    orderId,
  });
  if (!mission) {
    return { ok: false, summary: "Order not found or access denied." };
  }
  return { ok: true };
}

export async function executeClientTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AiToolContext
): Promise<AiToolResult> {
  switch (name) {
    case "get_recent_orders":
      return getRecentOrders(ctx, args);
    case "track_order":
      return trackOrder(ctx, args);
    case "search_restaurants":
      return searchRestaurants(ctx, args);
    case "get_user_region_scope":
      return getUserRegionScope(ctx);
    case "get_available_services":
      return getAvailableServices(ctx);
    case "explain_order_status":
      return explainOrderStatusTool(args);
    case "contact_support":
      return contactSupport(args);
    case "create_support_case":
      return createSupportCase(ctx, args);
    case "call_driver":
      return callDriver(ctx, args);
    case "message_driver":
      return messageDriver(ctx, args);
    case "call_restaurant":
      return callRestaurant(ctx, args);
    case "message_restaurant":
      return messageRestaurant(ctx, args);
    default:
      return { ok: false, summary: `Unknown tool: ${name}` };
  }
}

async function getRecentOrders(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const limitRaw = Number(args.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.min(10, Math.max(1, Math.trunc(limitRaw))) : 5;

  const { data: orders, error: ordersError } = await ctx.supabaseAdmin
    .from("orders")
    .select("id, kind, status, payment_status, created_at, pickup_address, dropoff_address, total, restaurant_name")
    .or(
      `client_user_id.eq.${ctx.userId},client_id.eq.${ctx.userId},created_by.eq.${ctx.userId},user_id.eq.${ctx.userId}`
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ordersError) {
    return { ok: false, summary: ordersError.message };
  }

  const { data: deliveries, error: drError } = await ctx.supabaseAdmin
    .from("delivery_requests")
    .select("id, status, payment_status, created_at, pickup_address, dropoff_address, total")
    .eq("client_user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (drError) {
    return { ok: false, summary: drError.message };
  }

  const items = [
    ...(orders ?? []).map((row) => ({ type: "order", ...row })),
    ...(deliveries ?? []).map((row) => ({ type: "delivery_request", ...row })),
  ]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);

  return {
    ok: true,
    summary: `Found ${items.length} recent item(s).`,
    data: { items },
    actions: items[0]
      ? [
          {
            type: "navigate",
            label: "Track latest",
            route: "ClientOrderDetails",
            params: { orderId: String((items[0] as { id: string }).id) },
            icon: "track",
          },
        ]
      : undefined,
  };
}

async function trackOrder(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return { ok: false, summary: "Valid order_id is required." };
  }

  const mission = await buildSharedMissionContext({
    supabaseAdmin: ctx.supabaseAdmin,
    userId: ctx.userId,
    viewerRole: "client",
    orderId,
  });

  if (!mission) {
    return { ok: false, summary: "Order not found or access denied." };
  }

  return {
    ok: true,
    summary: mission.safeSummary,
    data: { mission, statusExplanation: explainOrderStatus(mission.status) },
    actions: [
      {
        type: "navigate",
        label: "View order",
        route: "ClientOrderDetails",
        params: { orderId: mission.missionId },
        icon: "track",
      },
    ],
  };
}

async function searchRestaurants(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const query = String(args.query ?? args.q ?? "").trim().toLowerCase();
  const limitRaw = Number(args.limit ?? 8);
  const limit = Number.isFinite(limitRaw) ? Math.min(12, Math.max(1, Math.trunc(limitRaw))) : 8;

  let dbQuery = ctx.supabaseAdmin
    .from("restaurant_profiles")
    .select("user_id, restaurant_name, address, cuisine_type, is_accepting_orders, status")
    .eq("status", "approved")
    .eq("is_accepting_orders", true)
    .limit(limit);

  if (query) {
    dbQuery = dbQuery.or(
      `restaurant_name.ilike.%${query}%,address.ilike.%${query}%,cuisine_type.ilike.%${query}%`
    );
  }

  const { data, error } = await dbQuery;
  if (error) {
    return { ok: false, summary: error.message };
  }

  const restaurants = (data ?? []).map((row) => ({
    id: row.user_id,
    name: row.restaurant_name,
    address: row.address,
    cuisine: row.cuisine_type,
  }));

  return {
    ok: true,
    summary: `Found ${restaurants.length} restaurant(s)${query ? ` matching "${query}"` : ""}.`,
    data: { restaurants },
    actions: [
      {
        type: "navigate",
        label: "Browse restaurants",
        route: "ClientRestaurantList",
        params: {},
        icon: "food",
      },
    ],
  };
}

async function getUserRegionScope(ctx: AiToolContext): Promise<AiToolResult> {
  const scope = await resolveClientPlatformScope(ctx.supabaseAdmin, ctx.userId, {});
  const features = await resolvePlatformScopeFeatures(ctx.supabaseAdmin, scope);

  if (!features) {
    return { ok: false, summary: "Unable to resolve region scope." };
  }

  return {
    ok: true,
    summary: `Area: ${features.scope_label}`,
    data: {
      scope_label: features.scope_label,
      country_code: features.country_code,
      state_code: features.state_code,
      scope_source: features.scope_source,
    },
  };
}

async function getAvailableServices(ctx: AiToolContext): Promise<AiToolResult> {
  const scope = await resolveClientPlatformScope(ctx.supabaseAdmin, ctx.userId, {});
  const features = await resolvePlatformScopeFeatures(ctx.supabaseAdmin, scope);

  if (!features) {
    return { ok: false, summary: "Unable to resolve available services." };
  }

  return {
    ok: true,
    summary: features.message ?? "Services loaded for your area.",
    data: {
      taxi_available: features.taxi_available,
      delivery_available: features.delivery_available,
      restaurant_available: features.restaurant_available,
      marketplace_available: features.marketplace_available,
      maintenance_mode: features.maintenance_mode,
      coming_soon_services: features.coming_soon_services,
    },
  };
}

function explainOrderStatusTool(args: Record<string, unknown>): AiToolResult {
  const status = args.status ?? args.order_status;
  const explanation = explainOrderStatus(status);
  return {
    ok: true,
    summary: explanation,
    data: { status: String(status ?? ""), explanation },
  };
}

function contactSupport(args: Record<string, unknown>): AiToolResult {
  const info = getSupportContactInfo();
  const topic = String(args.topic ?? args.reason ?? "").trim();
  return {
    ok: true,
    summary: topic
      ? `Support is available for: ${topic}. Email ${info.email}.`
      : `Contact MMD support at ${info.email}.`,
    data: { email: info.email, supportUrl: info.supportUrl },
    actions: info.actions,
  };
}

function createSupportCase(ctx: AiToolContext, args: Record<string, unknown>): AiToolResult {
  const reason = String(args.reason ?? args.topic ?? "general").trim() || "general";
  const details = String(args.details ?? args.message ?? "").trim();
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();

  const caseRef = `MMD-${Date.now().toString(36).toUpperCase()}`;

  return {
    ok: true,
    summary: `Support case prepared (${caseRef}). A human agent will follow up.`,
    data: {
      caseRef,
      reason,
      details: details.slice(0, 500),
      orderId: UUID_RE.test(orderId) ? orderId : null,
      userId: ctx.userId,
      phase: "handoff_only",
    },
    actions: [
      {
        type: "navigate",
        label: "Open inbox",
        route: "ClientInbox",
        params: orderId && UUID_RE.test(orderId) ? { orderId } : {},
        icon: "support",
        priority: "high",
      },
    ],
    escalationReason: reason,
  };
}

async function callDriver(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return { ok: false, summary: "order_id is required to call your driver." };
  }

  const owned = await assertClientOwnsOrder(ctx, orderId);
  if (owned.ok === false) {
    return { ok: false, summary: owned.summary };
  }

  const mission = await buildSharedMissionContext({
    supabaseAdmin: ctx.supabaseAdmin,
    userId: ctx.userId,
    viewerRole: "client",
    orderId,
  });

  if (!mission?.driverAssigned) {
    return { ok: false, summary: "No driver assigned yet for this order." };
  }

  return {
    ok: true,
    summary: "Open your order to start a masked call with your driver.",
    data: { orderId, phase: "navigation_only" },
    actions: [
      {
        type: "navigate",
        label: "Call driver",
        route: "ClientOrderDetails",
        params: { orderId, action: "call_driver" },
        icon: "call",
      },
    ],
  };
}

async function messageDriver(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return { ok: false, summary: "order_id is required to message your driver." };
  }

  const owned = await assertClientOwnsOrder(ctx, orderId);
  if (owned.ok === false) {
    return { ok: false, summary: owned.summary };
  }

  return {
    ok: true,
    summary: "Open chat with your driver from the order screen.",
    data: { orderId, phase: "navigation_only" },
    actions: [
      {
        type: "navigate",
        label: "Message driver",
        route: "ClientChat",
        params: { orderId, targetRole: "driver" },
        icon: "message",
      },
    ],
  };
}

async function callRestaurant(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return { ok: false, summary: "order_id is required to call the restaurant." };
  }

  const owned = await assertClientOwnsOrder(ctx, orderId);
  if (owned.ok === false) {
    return { ok: false, summary: owned.summary };
  }

  return {
    ok: true,
    summary: "Open your order to start a masked call with the restaurant.",
    data: { orderId, phase: "navigation_only" },
    actions: [
      {
        type: "navigate",
        label: "Call restaurant",
        route: "ClientOrderDetails",
        params: { orderId, action: "call_restaurant" },
        icon: "call",
      },
    ],
  };
}

async function messageRestaurant(ctx: AiToolContext, args: Record<string, unknown>): Promise<AiToolResult> {
  const orderId = String(args.order_id ?? args.orderId ?? ctx.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return { ok: false, summary: "order_id is required to message the restaurant." };
  }

  const owned = await assertClientOwnsOrder(ctx, orderId);
  if (owned.ok === false) {
    return { ok: false, summary: owned.summary };
  }

  return {
    ok: true,
    summary: "Open chat with the restaurant from the order screen.",
    data: { orderId, phase: "navigation_only" },
    actions: [
      {
        type: "navigate",
        label: "Message restaurant",
        route: "ClientChat",
        params: { orderId, targetRole: "restaurant" },
        icon: "message",
      },
    ],
  };
}
