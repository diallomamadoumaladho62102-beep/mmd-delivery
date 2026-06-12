import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";
import {
  appendMarketplaceScopeQuery,
  type MarketplaceScopeInput,
} from "./marketplaceScope";

export type { MarketplaceScopeInput };

export type MarketplaceSeller = {
  id: string;
  business_name: string;
  country_code: string;
  city: string;
  address: string;
  region_code: string | null;
  status: string;
  created_at: string;
};

export type MarketplaceProduct = {
  id: string;
  seller_id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  category: string;
  image_paths: string[] | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MarketplaceOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  title: string;
  price_cents: number;
  quantity: number;
  currency: string;
};

export type MarketplaceOrderDraft = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  currency: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  country_code: string | null;
  region_code: string | null;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  notes: string | null;
  checkout_shadow?: {
    checkout_enabled?: boolean;
    message?: string | null;
  };
  delivery_status_shadow?: string | null;
  delivery_quote_shadow?: {
    customer_delivery_total_cents?: number;
    estimated_distance_miles?: number;
    estimated_minutes?: number;
  } | null;
  estimated_distance_miles?: number | null;
  estimated_minutes?: number | null;
  driver_earning_shadow_cents?: number | null;
  platform_margin_shadow_cents?: number | null;
  dispatch_shadow?: {
    dispatch_readiness?: string | null;
    live_dispatch_enabled?: boolean;
    drivers_notified?: boolean;
    message?: string | null;
  } | null;
  payment_status?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
  items?: MarketplaceOrderItem[];
};

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function buildMarketplacePath(
  path: string,
  query: Record<string, string | undefined>,
  scope?: MarketplaceScopeInput
): Promise<string> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) searchParams.set(key, value);
  }
  await appendMarketplaceScopeQuery(searchParams, scope);
  const qs = searchParams.toString();
  return qs ? `${path}?${qs}` : path;
}

async function marketplaceFetch(
  path: string,
  init?: RequestInit,
  scope?: MarketplaceScopeInput
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    const code = String(body.error ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (code === "marketplace_unavailable") {
      throw new Error(
        message ||
          "Marketplace coming soon in your area."
      );
    }
    throw new Error(message || code || `Request failed (${res.status})`);
  }
  return body;
}

export async function fetchMarketplaceSellers(
  scope?: MarketplaceScopeInput
): Promise<MarketplaceSeller[]> {
  const path = await buildMarketplacePath("/api/marketplace/sellers", {}, scope);
  const body = await marketplaceFetch(path, undefined, scope);
  return body.items ?? [];
}

export async function fetchMarketplaceProducts(
  sellerId: string,
  scope?: MarketplaceScopeInput
): Promise<MarketplaceProduct[]> {
  const path = await buildMarketplacePath(
    "/api/marketplace/products",
    { seller_id: sellerId },
    scope
  );
  const body = await marketplaceFetch(path, undefined, scope);
  return body.items ?? [];
}

export async function fetchMarketplaceDraft(
  params: {
    sellerId?: string;
    orderId?: string;
  },
  scope?: MarketplaceScopeInput
): Promise<MarketplaceOrderDraft | null> {
  const path = await buildMarketplacePath(
    "/api/marketplace/cart/draft",
    {
      seller_id: params.sellerId,
      order_id: params.orderId,
    },
    scope
  );
  const body = await marketplaceFetch(path, undefined, scope);
  return body.order ?? null;
}

export async function saveMarketplaceDraft(
  input: {
    sellerId: string;
    orderId?: string;
    items: Array<{ product_id: string; quantity: number }>;
    notes?: string;
    pickupLocationId?: string | null;
    dropoffLocationId?: string | null;
    sellerCountryCode?: string | null;
    locationCountryCode?: string | null;
    manualCountryCode?: string | null;
  }
): Promise<MarketplaceOrderDraft> {
  const scope: MarketplaceScopeInput = {
    sellerCountryCode: input.sellerCountryCode,
    locationCountryCode: input.locationCountryCode,
    manualCountryCode: input.manualCountryCode,
  };
  const path = await buildMarketplacePath("/api/marketplace/cart/draft", {}, scope);
  const body = await marketplaceFetch(
    path,
    {
      method: "POST",
      body: JSON.stringify({
        seller_id: input.sellerId,
        order_id: input.orderId,
        items: input.items,
        notes: input.notes ?? null,
        pickup_location_id: input.pickupLocationId ?? null,
        dropoff_location_id: input.dropoffLocationId ?? null,
      }),
    },
    scope
  );
  return body.order;
}

export async function fetchMarketplaceLiveCheckoutCapabilities(): Promise<{
  live_checkout_enabled: boolean;
  message?: string | null;
}> {
  try {
    const path = await buildMarketplacePath("/api/marketplace/checkout/live", {});
    const body = await marketplaceFetch(path);
    return {
      live_checkout_enabled: body.live_checkout_enabled === true,
      message: body.message ?? null,
    };
  } catch {
    return { live_checkout_enabled: false, message: null };
  }
}

export async function runMarketplaceLiveCheckout(
  orderId: string,
  scope?: MarketplaceScopeInput
): Promise<{
  checkout_url: string;
  stripe_checkout_session_id?: string;
  order?: MarketplaceOrderDraft;
}> {
  const path = await buildMarketplacePath("/api/marketplace/checkout/live", {}, scope);
  return marketplaceFetch(
    path,
    {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    },
    scope
  );
}

export async function runMarketplaceCheckout(
  orderId: string,
  scope?: MarketplaceScopeInput
) {
  const path = await buildMarketplacePath("/api/marketplace/checkout", {}, scope);
  return marketplaceFetch(
    path,
    {
      method: "POST",
      body: JSON.stringify({ order_id: orderId }),
    },
    scope
  );
}

export function formatMarketplaceMoney(cents: number, currency = "USD"): string {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}
