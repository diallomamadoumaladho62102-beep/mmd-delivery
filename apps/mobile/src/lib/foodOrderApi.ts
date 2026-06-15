import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";

export type FoodOrderLinePayload = {
  item_id: string;
  quantity: number;
  options?: unknown;
};

export type FoodOrderPricingPayload = {
  country_code: string;
  currency: string;
  config_key: string;
  subtotal: number;
  tax: number;
  tax_rate_pct: number;
  tax_source: string;
  service_fee: number;
  service_fee_pct: number;
  delivery_fee: number;
  delivery_fee_raw: number;
  delivery_discount_amount: number;
  promo_code_applied: string | null;
  promo_discount_amount: number;
  discounts: number;
  subtotal_after_discount: number;
  total: number;
  total_cents: number;
  distance_miles: number;
  eta_minutes: number;
  driver_payout_estimate: number;
  items: Array<{
    item_id: string;
    name: string;
    category: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
};

export type CreateFoodOrderPayload = {
  restaurant_id: string;
  restaurant_name?: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  items: FoodOrderLinePayload[];
  promo_code?: string | null;
};

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

function appendScopeQuery(path: string, scope?: { countryCode?: string | null; lat?: number; lng?: number }) {
  if (!scope) return path;
  const params = new URLSearchParams();
  if (scope.countryCode) params.set("country", scope.countryCode);
  if (scope.lat != null) params.set("lat", String(scope.lat));
  if (scope.lng != null) params.set("lng", String(scope.lng));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function foodOrderFetch(
  path: string,
  body: Record<string, unknown>,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getApiBaseUrl()}${appendScopeQuery(path, scope)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const message = String(payload.error ?? payload.message ?? "").trim();
    throw new Error(message || `Food order request failed (${res.status})`);
  }

  return payload;
}

export async function quoteFoodOrder(
  input: CreateFoodOrderPayload,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
): Promise<FoodOrderPricingPayload> {
  const body = await foodOrderFetch("/api/orders/food/quote", input, scope);
  return body.quote as FoodOrderPricingPayload;
}

export async function createFoodOrder(
  input: CreateFoodOrderPayload,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
): Promise<{ orderId: string; pricing: FoodOrderPricingPayload }> {
  const body = await foodOrderFetch("/api/orders/food/create", input, scope);
  return {
    orderId: String(body.order_id),
    pricing: body.pricing as FoodOrderPricingPayload,
  };
}
