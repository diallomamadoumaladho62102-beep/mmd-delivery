import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandCenterData } from "@/lib/restaurantCommandCenter";

export type AiGrowthRecommendation = {
  id: string;
  type: "demand_forecast" | "promo_suggestion" | "stock_alert" | "best_product";
  titleKey: string;
  bodyKey: string;
  actionKey: string | null;
  actionRoute: "promotions" | "inventory" | null;
  params: Record<string, string | number>;
  estimatedGain: number | null;
  currency: string;
};

export type RestaurantAiGrowthData = {
  generatedAt: string;
  hasEnoughData: boolean;
  recommendations: AiGrowthRecommendation[];
  bestProductToday: {
    name: string;
    quantitySold: number;
    revenue: number;
    currency: string;
  } | null;
};

type GenericRow = Record<string, unknown>;

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseItemsJson(value: unknown): Array<{ name?: string; quantity?: number; qty?: number }> {
  if (!Array.isArray(value)) return [];
  return value as Array<{ name?: string; quantity?: number; qty?: number }>;
}

function hourBucket(iso: string): number {
  return new Date(iso).getUTCHours();
}

export async function getRestaurantAiGrowth(params: {
  supabase: SupabaseClient;
  restaurantUserId: string;
  commandCenter?: CommandCenterData;
}): Promise<RestaurantAiGrowthData> {
  const { supabase, restaurantUserId, commandCenter } = params;
  const now = new Date();
  const lookbackStart = new Date(now);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 28);

  const { data: orderRows, error } = await supabase
    .from("orders")
    .select("id,created_at,status,total,subtotal,tax,currency,items_json")
    .eq("kind", "food")
    .eq("restaurant_id", restaurantUserId)
    .eq("payment_status", "paid")
    .gte("created_at", lookbackStart.toISOString())
    .in("status", ["delivered", "completed"]);

  if (error) {
    throw new Error(error.message || "Failed to load orders for AI growth");
  }

  const rows = (Array.isArray(orderRows) ? orderRows : []) as GenericRow[];
  const currency =
    commandCenter?.restaurant.currency ||
    String(rows.find((row) => row.currency)?.currency ?? "USD").toUpperCase();

  if (rows.length < 5) {
    return {
      generatedAt: now.toISOString(),
      hasEnoughData: false,
      recommendations: [],
      bestProductToday: commandCenter?.topProducts[0]
        ? {
            name: commandCenter.topProducts[0].name,
            quantitySold: commandCenter.topProducts[0].quantitySold,
            revenue: commandCenter.topProducts[0].revenue,
            currency,
          }
        : null,
    };
  }

  const hourCounts = new Array(24).fill(0);
  const productCounts = new Map<string, { name: string; qty: number; revenue: number }>();
  let totalRevenue = 0;

  for (const row of rows) {
    const created = String(row.created_at ?? "");
    if (created) hourCounts[hourBucket(created)] += 1;
    totalRevenue += asNumber(row.total) || asNumber(row.subtotal) + asNumber(row.tax);

    for (const item of parseItemsJson(row.items_json)) {
      const name = String(item.name ?? "").trim();
      if (!name) continue;
      const qty = asNumber(item.quantity ?? item.qty ?? 1);
      const key = name.toLowerCase();
      const existing = productCounts.get(key) ?? { name, qty: 0, revenue: 0 };
      existing.qty += qty;
      existing.revenue += (asNumber(row.total) / Math.max(parseItemsJson(row.items_json).length, 1)) * qty;
      productCounts.set(key, existing);
    }
  }

  const currentHour = now.getUTCHours();
  const peakStart = Math.max(0, currentHour - 1);
  const peakEnd = Math.min(23, currentHour + 2);
  const peakOrders = hourCounts
    .slice(peakStart, peakEnd + 1)
    .reduce((a, b) => a + b, 0);
  const avgHourly = rows.length / 24;
  const demandIncreasePct =
    avgHourly > 0 ? Math.round(((peakOrders / Math.max(peakEnd - peakStart + 1, 1) - avgHourly) / avgHourly) * 100) : 0;

  const topProduct = Array.from(productCounts.values()).sort((a, b) => b.qty - a.qty)[0] ?? null;
  const secondProduct = Array.from(productCounts.values()).sort((a, b) => b.qty - a.qty)[1] ?? null;

  const { data: unavailableItems } = await supabase
    .from("restaurant_items")
    .select("id,name,is_available")
    .eq("restaurant_user_id", restaurantUserId)
    .eq("is_available", false)
    .limit(5);

  const recommendations: AiGrowthRecommendation[] = [];

  if (demandIncreasePct > 10 && topProduct) {
    const extraUnits = Math.max(1, Math.ceil(topProduct.qty * (demandIncreasePct / 100)));
    const avgItemRevenue = topProduct.qty > 0 ? topProduct.revenue / topProduct.qty : 0;
    recommendations.push({
      id: "demand-forecast",
      type: "demand_forecast",
      titleKey: "restaurant.commandCenter.ai.demandForecastTitle",
      bodyKey: "restaurant.commandCenter.ai.demandForecastBody",
      actionKey: null,
      actionRoute: null,
      params: {
        percent: Math.max(demandIncreasePct, 10),
        startHour: peakStart,
        endHour: peakEnd,
        product: topProduct.name,
        extraUnits,
      },
      estimatedGain: Math.round(extraUnits * avgItemRevenue),
      currency,
    });
  }

  if (topProduct && secondProduct) {
    const comboGain = Math.round((topProduct.revenue + secondProduct.revenue) * 0.12);
    recommendations.push({
      id: "promo-suggestion",
      type: "promo_suggestion",
      titleKey: "restaurant.commandCenter.ai.promoSuggestionTitle",
      bodyKey: "restaurant.commandCenter.ai.promoSuggestionBody",
      actionKey: null,
      actionRoute: null,
      params: {
        productA: topProduct.name,
        productB: secondProduct.name,
      },
      estimatedGain: comboGain,
      currency,
    });
  }

  const unavailable = (unavailableItems ?? []) as GenericRow[];
  if (unavailable.length > 0) {
    const names = unavailable
      .map((row) => String(row.name ?? "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    recommendations.push({
      id: "stock-alert",
      type: "stock_alert",
      titleKey: "restaurant.commandCenter.ai.stockAlertTitle",
      bodyKey: "restaurant.commandCenter.ai.stockAlertBody",
      actionKey: "restaurant.commandCenter.ai.viewInventory",
      actionRoute: "inventory",
      params: { items: names, count: unavailable.length },
      estimatedGain: null,
      currency,
    });
  }

  const todayProduct = commandCenter?.topProducts[0] ?? null;
  if (todayProduct) {
    recommendations.push({
      id: "best-product-today",
      type: "best_product",
      titleKey: "restaurant.commandCenter.ai.bestProductTitle",
      bodyKey: "restaurant.commandCenter.ai.bestProductBody",
      actionKey: null,
      actionRoute: null,
      params: {
        product: todayProduct.name,
        quantity: todayProduct.quantitySold,
        revenue: todayProduct.revenue,
      },
      estimatedGain: todayProduct.revenue,
      currency,
    });
  }

  return {
    generatedAt: now.toISOString(),
    hasEnoughData: recommendations.length > 0,
    recommendations,
    bestProductToday: todayProduct
      ? {
          name: todayProduct.name,
          quantitySold: todayProduct.quantitySold,
          revenue: todayProduct.revenue,
          currency,
        }
      : topProduct
        ? {
            name: topProduct.name,
            quantitySold: topProduct.qty,
            revenue: Math.round(topProduct.revenue * 100) / 100,
            currency,
          }
        : null,
  };
}
