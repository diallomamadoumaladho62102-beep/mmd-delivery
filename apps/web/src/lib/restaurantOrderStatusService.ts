import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRestaurantOrderEligible } from "@/lib/restaurantOrderAccess";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { resolveRestaurantPlatformCountry } from "@/lib/platformCountryResolver";
import { triggerSmartDispatchForOrder } from "@/lib/triggerSmartDispatch";

export type RestaurantStatusTransition = "accepted" | "prepared" | "ready";

const NEXT_STATUS: Record<string, RestaurantStatusTransition[]> = {
  pending: ["accepted"],
  accepted: ["prepared"],
  prepared: ["ready"],
};

export type TransitionRestaurantOrderInput = {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  nextStatus: RestaurantStatusTransition;
  actorUserId: string;
  actorRole?: "restaurant" | "system";
  source?: string;
  metadata?: Record<string, unknown>;
  dispatchOrigin?: string | null;
  estimatedPrepMinutes?: number | null;
  markAutoAccepted?: boolean;
};

export type TransitionRestaurantOrderResult =
  | {
      ok: true;
      orderId: string;
      status: string;
      smartDispatch: Awaited<ReturnType<typeof triggerSmartDispatchForOrder>> | null;
    }
  | {
      ok: false;
      error: string;
      httpStatus?: number;
      details?: Record<string, unknown>;
    };

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function transitionRestaurantOrderStatus(
  input: TransitionRestaurantOrderInput,
): Promise<TransitionRestaurantOrderResult> {
  const {
    supabaseAdmin,
    orderId,
    nextStatus,
    actorUserId,
    actorRole = "restaurant",
    source = "restaurantOrderStatusService",
    metadata = {},
    dispatchOrigin,
    estimatedPrepMinutes,
    markAutoAccepted = false,
  } = input;

  const { data: order, error: readError } = await supabaseAdmin
    .from("orders")
    .select(
      "id,kind,status,driver_id,restaurant_id,restaurant_user_id,payment_status,created_at",
    )
    .eq("id", orderId)
    .eq("kind", "food")
    .eq("payment_status", "paid")
    .maybeSingle();

  if (readError) {
    return { ok: false, error: readError.message, httpStatus: 500 };
  }
  if (!order) {
    return { ok: false, error: "Order not found", httpStatus: 404 };
  }

  const restaurantUserId = String(order.restaurant_user_id ?? order.restaurant_id ?? "");
  const ownsOrder =
    restaurantUserId === actorUserId ||
    actorRole === "system" ||
    normalize(order.restaurant_id) === normalize(actorUserId) ||
    normalize(order.restaurant_user_id) === normalize(actorUserId);

  if (!ownsOrder) {
    return { ok: false, error: "Forbidden", httpStatus: 403 };
  }

  if (actorRole === "restaurant") {
    const restaurantAccess = await assertRestaurantOrderEligible(
      supabaseAdmin,
      actorUserId,
    );
    if (restaurantAccess.ok === false) {
      return {
        ok: false,
        error: restaurantAccess.error,
        httpStatus: restaurantAccess.httpStatus,
      };
    }
  }

  const currentStatus = normalize(order.status);
  const allowedNext = NEXT_STATUS[currentStatus] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    return {
      ok: false,
      error: "Invalid status transition",
      httpStatus: 409,
      details: { status: currentStatus, requested: nextStatus },
    };
  }

  if (nextStatus === "accepted") {
    const restaurantCountry = await resolveRestaurantPlatformCountry(
      supabaseAdmin,
      restaurantUserId,
    );
    const platformCheck = await assertPlatformFeature(
      supabaseAdmin,
      restaurantCountry,
      "restaurant",
      "active",
    );
    if (platformCheck.ok === false) {
      return {
        ok: false,
        error: platformCheck.error,
        httpStatus: 403,
        details: {
          message: platformCheck.message,
          country_code: platformCheck.country_code,
        },
      };
    }
  }

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    updated_at: nowIso,
  };

  if (nextStatus === "accepted") {
    updatePayload.restaurant_accepted_at = nowIso;
    updatePayload.accepted_at = nowIso;
    if (estimatedPrepMinutes != null && estimatedPrepMinutes > 0) {
      updatePayload.estimated_prep_minutes = estimatedPrepMinutes;
      updatePayload.prep_ready_at = new Date(
        Date.now() + estimatedPrepMinutes * 60 * 1000,
      ).toISOString();
    }
    if (markAutoAccepted) {
      updatePayload.auto_accepted = true;
    }
  }
  if (nextStatus === "prepared") {
    updatePayload.restaurant_prepared_at = nowIso;
  }
  if (nextStatus === "ready") {
    updatePayload.ready_at = nowIso;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId)
    .eq("kind", "food")
    .eq("payment_status", "paid")
    .eq("status", order.status)
    .select("id,status,driver_id,restaurant_user_id,client_user_id,created_by")
    .maybeSingle();

  if (updateError) {
    return { ok: false, error: updateError.message, httpStatus: 500 };
  }
  if (!updated) {
    return {
      ok: false,
      error: "Order status changed. Please refresh and try again.",
      httpStatus: 409,
    };
  }

  const eventType =
    nextStatus === "accepted"
      ? "restaurant_accept"
      : nextStatus === "prepared"
        ? "restaurant_prepared"
        : "restaurant_ready";

  await supabaseAdmin.from("order_events").insert({
    order_id: orderId,
    event_type: eventType,
    old_status: currentStatus,
    new_status: nextStatus,
    note: actorRole === "system" ? "Automatic restaurant workflow" : null,
    actor_id: actorUserId,
    created_at: nowIso,
    description:
      nextStatus === "accepted"
        ? actorRole === "system"
          ? "Order accepted automatically"
          : "Restaurant accepted the order"
        : nextStatus === "prepared"
          ? "Restaurant started preparing the order"
          : "Restaurant marked the order ready",
    triggered_by: actorUserId,
    triggered_role: actorRole,
    metadata: {
      source,
      at: nowIso,
      ...metadata,
    },
  });

  let smartDispatch: Awaited<ReturnType<typeof triggerSmartDispatchForOrder>> | null =
    null;

  if (nextStatus === "ready" && !updated.driver_id && dispatchOrigin) {
    smartDispatch = await triggerSmartDispatchForOrder({
      origin: dispatchOrigin,
      orderId,
      wave: 1,
    });
  }

  return {
    ok: true,
    orderId,
    status: updated.status,
    smartDispatch,
  };
}
