import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";

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
  notes: string | null;
  checkout_shadow?: {
    checkout_enabled?: boolean;
    message?: string | null;
  };
  created_at: string;
  updated_at: string;
  items?: MarketplaceOrderItem[];
};

async function getAccessToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

async function marketplaceFetch(path: string, init?: RequestInit) {
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
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return body;
}

export async function fetchMarketplaceSellers(): Promise<MarketplaceSeller[]> {
  const body = await marketplaceFetch("/api/marketplace/sellers");
  return body.items ?? [];
}

export async function fetchMarketplaceProducts(
  sellerId: string
): Promise<MarketplaceProduct[]> {
  const body = await marketplaceFetch(
    `/api/marketplace/products?seller_id=${encodeURIComponent(sellerId)}`
  );
  return body.items ?? [];
}

export async function fetchMarketplaceDraft(params: {
  sellerId?: string;
  orderId?: string;
}): Promise<MarketplaceOrderDraft | null> {
  const qs = new URLSearchParams();
  if (params.sellerId) qs.set("seller_id", params.sellerId);
  if (params.orderId) qs.set("order_id", params.orderId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const body = await marketplaceFetch(`/api/marketplace/cart/draft${suffix}`);
  return body.order ?? null;
}

export async function saveMarketplaceDraft(input: {
  sellerId: string;
  orderId?: string;
  items: Array<{ product_id: string; quantity: number }>;
  notes?: string;
}): Promise<MarketplaceOrderDraft> {
  const body = await marketplaceFetch("/api/marketplace/cart/draft", {
    method: "POST",
    body: JSON.stringify({
      seller_id: input.sellerId,
      order_id: input.orderId,
      items: input.items,
      notes: input.notes ?? null,
    }),
  });
  return body.order;
}

export async function runMarketplaceCheckout(orderId: string) {
  return marketplaceFetch("/api/marketplace/checkout", {
    method: "POST",
    body: JSON.stringify({ order_id: orderId }),
  });
}

export function formatMarketplaceMoney(cents: number, currency = "USD"): string {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}
