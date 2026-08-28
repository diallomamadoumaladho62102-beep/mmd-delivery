import type { AiToolContext, AiToolResult } from "@/lib/ai/aiTypes";
import { quoteFoodOrderServerSide } from "@/lib/foodOrderService";
import type { FoodOrderLineInput } from "@/lib/foodOrderServerPricing";

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseItems(raw: unknown): FoodOrderLineInput[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      const itemId = String(rec.item_id ?? rec.id ?? "").trim();
      const quantity = Math.max(1, Math.trunc(Number(rec.quantity ?? 1)));
      if (!itemId) return null;
      return {
        item_id: itemId,
        quantity,
        options: Array.isArray(rec.options) ? rec.options : undefined,
      } as FoodOrderLineInput;
    })
    .filter((row): row is FoodOrderLineInput => row != null);
}

export async function getRestaurantMenu(
  ctx: AiToolContext,
  args: Record<string, unknown>
): Promise<AiToolResult> {
  const restaurantId = String(
    args.restaurant_id ?? args.restaurant_user_id ?? args.restaurantId ?? ""
  ).trim();
  if (!restaurantId) {
    return { ok: false, summary: "restaurant_id is required to load a menu." };
  }

  const { data: profile } = await ctx.supabaseAdmin
    .from("restaurant_profiles")
    .select("user_id, restaurant_name, status, is_accepting_orders")
    .eq("user_id", restaurantId)
    .maybeSingle();

  if (!profile || profile.status !== "approved" || profile.is_accepting_orders !== true) {
    return { ok: false, summary: "This restaurant is not available for orders right now." };
  }

  const { data, error } = await ctx.supabaseAdmin
    .from("restaurant_items")
    .select("id, name, description, price_cents, category, is_available, stock_qty, options_json")
    .eq("restaurant_user_id", restaurantId)
    .order("position", { ascending: true })
    .limit(40);

  if (error) {
    return { ok: false, summary: error.message };
  }

  const items = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents,
    category: row.category,
    available: row.is_available === true && (row.stock_qty == null || Number(row.stock_qty) > 0),
    stock_qty: row.stock_qty,
    options: row.options_json ?? null,
  }));

  return {
    ok: true,
    summary: `Menu for ${profile.restaurant_name ?? "restaurant"}: ${items.length} item(s).`,
    data: {
      restaurant_id: restaurantId,
      restaurant_name: profile.restaurant_name,
      items,
    },
    actions: [
      {
        type: "navigate",
        label: "Open restaurant menu",
        route: "ClientRestaurantMenu",
        params: {
          restaurantId,
          restaurantName: String(profile.restaurant_name ?? "Restaurant"),
        },
      },
    ],
  };
}

export async function quoteFoodOrder(
  ctx: AiToolContext,
  args: Record<string, unknown>
): Promise<AiToolResult> {
  const restaurantId = String(
    args.restaurant_id ?? args.restaurant_user_id ?? args.restaurantId ?? ""
  ).trim();
  const items = parseItems(args.items);
  const pickupAddress = String(args.pickup_address ?? args.pickupAddress ?? "").trim();
  const dropoffAddress = String(args.dropoff_address ?? args.dropoffAddress ?? "").trim();
  const pickupLat = num(args.pickup_lat ?? args.pickupLat);
  const pickupLng = num(args.pickup_lng ?? args.pickupLng);
  const dropoffLat = num(args.dropoff_lat ?? args.dropoffLat);
  const dropoffLng = num(args.dropoff_lng ?? args.dropoffLng);
  const countryCode = String(args.country_code ?? args.countryCode ?? "US").trim() || "US";

  if (!restaurantId || items.length === 0) {
    return {
      ok: false,
      summary: "I need a restaurant and at least one menu item to estimate a food order.",
    };
  }

  if (
    !pickupAddress ||
    !dropoffAddress ||
    pickupLat == null ||
    pickupLng == null ||
    dropoffLat == null ||
    dropoffLng == null
  ) {
    return {
      ok: true,
      requiresConfirmation: true,
      summary:
        "I can prepare this order. Open the restaurant menu to confirm the delivery address and official total. MMD AI will not charge you.",
      data: { restaurant_id: restaurantId, items, phase: "needs_address" },
      actions: [
        {
          type: "navigate",
          label: "Confirm food order",
          route: "ClientRestaurantMenu",
          params: {
            restaurantId,
            restaurantName: String(args.restaurant_name ?? "Restaurant"),
          },
          priority: "high",
        },
      ],
    };
  }

  try {
    const pricing = await quoteFoodOrderServerSide({
      supabaseAdmin: ctx.supabaseAdmin,
      restaurantUserId: restaurantId,
      pickupAddress,
      dropoffAddress,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      items,
      countryCode,
      promoCode: String(args.promo_code ?? "").trim() || undefined,
    });

    return {
      ok: true,
      requiresConfirmation: true,
      summary: `Food estimate ${pricing.totalCents / 100}. This is not a charge. Confirm in the restaurant menu to pay.`,
      data: {
        restaurant_id: restaurantId,
        items,
        total_cents: pricing.totalCents,
        phase: "estimate_only",
      },
      actions: [
        {
          type: "navigate",
          label: "Confirm and continue to checkout",
          route: "ClientRestaurantMenu",
          params: {
            restaurantId,
            restaurantName: String(args.restaurant_name ?? "Restaurant"),
          },
          priority: "high",
        },
      ],
    };
  } catch (e) {
    return {
      ok: false,
      summary:
        e instanceof Error
          ? e.message
          : "I could not estimate this order. Open the restaurant menu for the official total.",
      actions: [
        {
          type: "navigate",
          label: "Open restaurant menu",
          route: "ClientRestaurantMenu",
          params: { restaurantId, restaurantName: "Restaurant" },
        },
      ],
    };
  }
}

export function prepareFoodOrder(args: Record<string, unknown>): AiToolResult {
  const restaurantId = String(
    args.restaurant_id ?? args.restaurant_user_id ?? args.restaurantId ?? ""
  ).trim();
  const restaurantName = String(args.restaurant_name ?? args.restaurantName ?? "Restaurant");
  const items = parseItems(args.items);

  if (!restaurantId) {
    return { ok: false, summary: "Choose a restaurant before I can prepare an order." };
  }

  return {
    ok: true,
    requiresConfirmation: true,
    summary: `Ready to continue a food order at ${restaurantName}${
      items.length ? ` (${items.length} item(s))` : ""
    }. Confirm to open the official menu and checkout. MMD AI will not take payment.`,
    data: { restaurant_id: restaurantId, items, phase: "prepare_only" },
    actions: [
      {
        type: "navigate",
        label: "Confirm food order",
        route: "ClientRestaurantMenu",
        params: { restaurantId, restaurantName },
        priority: "high",
      },
    ],
  };
}
