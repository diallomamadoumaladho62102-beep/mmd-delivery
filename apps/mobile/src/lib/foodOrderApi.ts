import { getApiBaseUrl } from "../../lib/apiBase";
import {
  AUTH_ACTION_TIMEOUT_MS,
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "./bootFailOpen";
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
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
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
  leave_at_door?: boolean;
};

async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      CLIENT_SCREEN_FETCH_TIMEOUT_MS,
      "food_order_session",
    );
    if (error) return null;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
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

  const res = await fetchWithTimeout(
    `${getApiBaseUrl()}${appendScopeQuery(path, scope)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    AUTH_ACTION_TIMEOUT_MS,
    "food_order_fetch",
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const code = String(payload.code ?? payload.error ?? "").trim();
    const message = String(payload.error ?? payload.message ?? "").trim();
    const err = new Error(message || `Food order request failed (${res.status})`) as Error & {
      code?: string;
      error?: string;
    };
    err.code = code || undefined;
    err.error = code || message || undefined;
    throw err;
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

/** Pay-then-create: Stripe Checkout from quote — no orders row until paid. */
export function startFoodCheckoutFromQuote(
  payload: CreateFoodOrderPayload & { expectedQuoteTotalCents?: number },
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
) {
  return foodOrderFetch(
    "/api/stripe/client/create-food-quote-checkout-session",
    {
      restaurant_id: payload.restaurant_id,
      restaurant_name: payload.restaurant_name,
      pickup_address: payload.pickup_address,
      dropoff_address: payload.dropoff_address,
      pickup_lat: payload.pickup_lat,
      pickup_lng: payload.pickup_lng,
      dropoff_lat: payload.dropoff_lat,
      dropoff_lng: payload.dropoff_lng,
      items: payload.items,
      promo_code: payload.promo_code,
      leave_at_door: payload.leave_at_door,
      expectedQuoteTotalCents: payload.expectedQuoteTotalCents,
    },
    scope
  );
}

export async function confirmFoodQuoteCheckoutPaid(
  foodCheckoutId: string,
  sessionId?: string | null
) {
  return foodOrderFetch("/api/stripe/client/confirm-paid", {
    food_checkout_id: foodCheckoutId,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
}
