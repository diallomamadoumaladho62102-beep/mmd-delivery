import type { SupabaseClient } from "@supabase/supabase-js";
import { isRestaurantWithinOpeningHours } from "@/lib/restaurantOpeningHours";
import {
  DEFAULT_RESTAURANT_AUTOMATION_SETTINGS,
  type RestaurantAutomationProfile,
  type RestaurantOrderAutomationSettings,
} from "@/lib/restaurantOrderAutomationTypes";
import { transitionRestaurantOrderStatus } from "@/lib/restaurantOrderStatusService";
import { queueRestaurantPrintJobsForOrder } from "@/lib/restaurantPrintJobs";
import { notifyClientOrderAccepted } from "@/lib/clientPushNotifications";
import { notifyOrderAcceptedEmail } from "@/lib/transactionalEmails";
import { notifyRestaurantNewPaidOrder } from "@/lib/restaurantPushNotifications";

const AUTOMATION_SELECT =
  "user_id,restaurant_name,status,is_accepting_orders,opening_hours,auto_accept_orders_enabled,auto_accept_only_during_hours,default_prep_minutes,auto_pause_when_closed,auto_pause_when_busy,busy_order_threshold,auto_print_enabled,print_kitchen_ticket,print_customer_ticket,print_driver_ticket,print_copies,print_paper_width,print_show_qr_code,print_special_instructions";

export function extractAutomationSettings(
  profile: Partial<RestaurantAutomationProfile> | null | undefined,
): RestaurantOrderAutomationSettings {
  return {
    auto_accept_orders_enabled: Boolean(
      profile?.auto_accept_orders_enabled ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.auto_accept_orders_enabled,
    ),
    auto_accept_only_during_hours: Boolean(
      profile?.auto_accept_only_during_hours ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.auto_accept_only_during_hours,
    ),
    default_prep_minutes: Number(
      profile?.default_prep_minutes ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.default_prep_minutes,
    ),
    auto_pause_when_closed: Boolean(
      profile?.auto_pause_when_closed ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.auto_pause_when_closed,
    ),
    auto_pause_when_busy: Boolean(
      profile?.auto_pause_when_busy ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.auto_pause_when_busy,
    ),
    busy_order_threshold: Number(
      profile?.busy_order_threshold ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.busy_order_threshold,
    ),
    auto_print_enabled: Boolean(
      profile?.auto_print_enabled ?? DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.auto_print_enabled,
    ),
    print_kitchen_ticket: Boolean(
      profile?.print_kitchen_ticket ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_kitchen_ticket,
    ),
    print_customer_ticket: Boolean(
      profile?.print_customer_ticket ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_customer_ticket,
    ),
    print_driver_ticket: Boolean(
      profile?.print_driver_ticket ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_driver_ticket,
    ),
    print_copies: Number(
      profile?.print_copies ?? DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_copies,
    ),
    print_paper_width:
      profile?.print_paper_width === "58mm" ? "58mm" : "80mm",
    print_show_qr_code: Boolean(
      profile?.print_show_qr_code ?? DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_show_qr_code,
    ),
    print_special_instructions: Boolean(
      profile?.print_special_instructions ??
        DEFAULT_RESTAURANT_AUTOMATION_SETTINGS.print_special_instructions,
    ),
  };
}

export async function loadRestaurantAutomationProfile(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
): Promise<RestaurantAutomationProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_profiles")
    .select(AUTOMATION_SELECT)
    .eq("user_id", restaurantUserId)
    .maybeSingle();

  if (error) throw error;
  return (data as RestaurantAutomationProfile) ?? null;
}

type OrderItemJson = {
  item_id?: string;
  name?: string;
  quantity?: number;
};

async function validateOrderItemsAvailable(
  supabaseAdmin: SupabaseClient,
  order: { items_json?: unknown; restaurant_user_id?: string | null },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const items = Array.isArray(order.items_json)
    ? (order.items_json as OrderItemJson[])
    : [];

  if (items.length === 0) {
    return { ok: false, reason: "items_invalid" };
  }

  const itemIds = items
    .map((line) => String(line.item_id ?? "").trim())
    .filter(Boolean);

  if (itemIds.length === 0 || itemIds.length !== items.length) {
    return { ok: false, reason: "items_invalid" };
  }

  const restaurantUserId = String(order.restaurant_user_id ?? "").trim();
  let query = supabaseAdmin
    .from("restaurant_items")
    .select("id,is_available")
    .in("id", itemIds);

  if (restaurantUserId) {
    query = query.eq("restaurant_user_id", restaurantUserId);
  }

  const { data: menuItems, error } = await query;

  if (error) return { ok: false, reason: "menu_lookup_failed" };

  const unavailable = new Set(
    (menuItems ?? [])
      .filter((row) => row.is_available === false)
      .map((row) => String(row.id)),
  );

  if (unavailable.size > 0) {
    return { ok: false, reason: "item_unavailable" };
  }

  const foundIds = new Set((menuItems ?? []).map((row) => String(row.id)));
  for (const itemId of itemIds) {
    if (!foundIds.has(itemId)) {
      return { ok: false, reason: "item_missing" };
    }
  }

  return { ok: true };
}

async function isRestaurantTooBusy(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  threshold: number,
): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("kind", "food")
    .eq("restaurant_user_id", restaurantUserId)
    .in("status", ["accepted", "prepared"]);

  // Fail closed: on error treat as busy so auto-accept does not continue blindly.
  if (error) return true;
  return (count ?? 0) >= threshold;
}

export type AutoAcceptEvaluation =
  | { ok: true; reason: "eligible" }
  | { ok: false; reason: string };

export async function evaluateAutoAcceptEligibility(
  supabaseAdmin: SupabaseClient,
  input: {
    profile: RestaurantAutomationProfile;
    order: {
      kind?: string | null;
      status?: string | null;
      payment_status?: string | null;
      items_json?: unknown;
    };
    now?: Date;
  },
): Promise<AutoAcceptEvaluation> {
  const settings = extractAutomationSettings(input.profile);
  const now = input.now ?? new Date();

  if (!settings.auto_accept_orders_enabled) {
    return { ok: false, reason: "auto_accept_disabled" };
  }

  if (String(input.order.kind ?? "").toLowerCase() !== "food") {
    return { ok: false, reason: "not_food_order" };
  }

  if (String(input.order.payment_status ?? "").toLowerCase() !== "paid") {
    return { ok: false, reason: "payment_not_confirmed" };
  }

  if (String(input.order.status ?? "").toLowerCase() !== "pending") {
    return { ok: false, reason: "order_not_pending" };
  }

  if (input.profile.status !== "approved") {
    return { ok: false, reason: "restaurant_not_approved" };
  }

  if (input.profile.is_accepting_orders !== true) {
    return { ok: false, reason: "restaurant_paused" };
  }

  const withinHours = isRestaurantWithinOpeningHours(input.profile.opening_hours, now);

  if (settings.auto_pause_when_closed && !withinHours) {
    return { ok: false, reason: "restaurant_closed" };
  }

  if (settings.auto_accept_only_during_hours && !withinHours) {
    return { ok: false, reason: "outside_opening_hours" };
  }

  if (
    settings.auto_pause_when_busy &&
    (await isRestaurantTooBusy(
      supabaseAdmin,
      input.profile.user_id,
      settings.busy_order_threshold,
    ))
  ) {
    return { ok: false, reason: "restaurant_too_busy" };
  }

  const stock = await validateOrderItemsAvailable(supabaseAdmin, {
    items_json: input.order.items_json,
    restaurant_user_id: input.profile.user_id,
  });
  if (stock.ok === false) return { ok: false, reason: stock.reason };

  return { ok: true, reason: "eligible" };
}

export type AutoAcceptResult =
  | {
      ok: true;
      accepted: true;
      orderId: string;
      printJobsCreated: number;
    }
  | {
      ok: true;
      accepted: false;
      reason: string;
    }
  | {
      ok: false;
      error: string;
    };

export async function tryAutoAcceptPaidFoodOrder(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    dispatchOrigin?: string | null;
  },
): Promise<AutoAcceptResult> {
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id,kind,status,payment_status,restaurant_user_id,restaurant_id,items_json,client_user_id,created_by,total,grand_total,currency,pickup_code,dropoff_code,leave_at_door,items_json",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!order) return { ok: false, error: "order_not_found" };

  const restaurantUserId = String(order.restaurant_user_id ?? order.restaurant_id ?? "");
  if (!restaurantUserId) {
    return { ok: true, accepted: false, reason: "missing_restaurant" };
  }

  const profile = await loadRestaurantAutomationProfile(supabaseAdmin, restaurantUserId);
  if (!profile) return { ok: true, accepted: false, reason: "restaurant_profile_missing" };

  const eligibility = await evaluateAutoAcceptEligibility(supabaseAdmin, {
    profile,
    order,
  });

  if (!eligibility.ok) {
    return { ok: true, accepted: false, reason: eligibility.reason };
  }

  const settings = extractAutomationSettings(profile);

  const transition = await transitionRestaurantOrderStatus({
    supabaseAdmin,
    orderId: input.orderId,
    nextStatus: "accepted",
    actorUserId: restaurantUserId,
    actorRole: "system",
    source: "restaurantOrderAutomation",
    metadata: { auto_accept: true },
    estimatedPrepMinutes: settings.default_prep_minutes,
    markAutoAccepted: true,
  });

  if (transition.ok === false) {
    return { ok: false, error: transition.error };
  }

  await notifyClientOrderAccepted({
    supabaseAdmin,
    userIds: [order.client_user_id, order.created_by],
    orderId: input.orderId,
    prepMinutes: settings.default_prep_minutes,
  });

  await notifyOrderAcceptedEmail({
    supabaseAdmin,
    clientUserId: order.client_user_id ?? order.created_by ?? null,
    orderId: input.orderId,
    prepMinutes: settings.default_prep_minutes,
  });

  let printJobsCreated = 0;
  if (settings.auto_print_enabled) {
    printJobsCreated = await queueRestaurantPrintJobsForOrder({
      supabaseAdmin,
      restaurantUserId,
      orderId: input.orderId,
      settings,
      source: "auto",
    });
  }

  return {
    ok: true,
    accepted: true,
    orderId: input.orderId,
    printJobsCreated,
  };
}

export async function runFoodOrderPaymentSideEffects(
  supabaseAdmin: SupabaseClient,
  input: {
    orderId: string;
    dispatchOrigin?: string | null;
    notifyClientPaid?: boolean;
    notifyRestaurant?: boolean;
  },
): Promise<void> {
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,kind,client_user_id,created_by,restaurant_user_id,restaurant_id,payment_status")
    .eq("id", input.orderId)
    .maybeSingle();

  if (!order || String(order.payment_status ?? "").toLowerCase() !== "paid") return;

  if (input.notifyRestaurant !== false) {
    await notifyRestaurantNewPaidOrder({
      supabaseAdmin,
      restaurantUserId: String(order.restaurant_user_id ?? order.restaurant_id ?? ""),
      orderId: input.orderId,
    });
  }

  if (String(order.kind ?? "").toLowerCase() === "food") {
    await tryAutoAcceptPaidFoodOrder(supabaseAdmin, {
      orderId: input.orderId,
      dispatchOrigin: input.dispatchOrigin ?? null,
    });
  }
}
