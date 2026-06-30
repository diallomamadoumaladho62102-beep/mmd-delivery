import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

export type CommandCenterDriverCard = {
  orderId: string;
  orderLabel: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl: string | null;
  driverRating: number | null;
  etaMinutes: number | null;
  distanceMeters: number | null;
  arrivedSecondsAgo: number | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
};

export type CommandCenterNewOrderCard = {
  orderId: string;
  orderLabel: string;
  itemCount: number;
  totalAmount: number;
  currency: string;
  receivedSecondsAgo: number;
  acceptExpiresAt: string | null;
};

export type CommandCenterAttentionCard = {
  orderId: string;
  orderLabel: string;
  reasonKey: string;
  reasonParams: Record<string, string | number>;
  status: string;
};

export type CommandCenterTopProduct = {
  itemId: string | null;
  name: string;
  imageUrl: string | null;
  quantitySold: number;
  revenue: number;
  currency: string;
};

export type CommandCenterMapDriver = {
  driverId: string;
  driverName: string;
  lat: number;
  lng: number;
  status: "arrived" | "approaching" | "en_route";
  orderId: string;
  orderLabel: string;
  etaMinutes: number | null;
};

export type CommandCenterMapCustomer = {
  orderId: string;
  orderLabel: string;
  lat: number;
  lng: number;
};

export type RestaurantCommandCenterData = {
  generatedAt: string;
  restaurant: {
    userId: string;
    name: string;
    isOpen: boolean;
    lat: number | null;
    lng: number | null;
    currency: string;
  };
  kpis: {
    revenueToday: number;
    revenueYesterday: number;
    revenueChangePct: number | null;
    ordersToday: number;
    ordersYesterday: number;
    ordersChangePct: number | null;
    customersToday: number;
    customersYesterday: number;
    customersChangePct: number | null;
    averageBasket: number | null;
    averageBasketYesterday: number | null;
    averageBasketChangePct: number | null;
    rating: number | null;
    ratingCount: number;
    currency: string;
  };
  liveOperations: {
    driverArrived: CommandCenterDriverCard[];
    driverApproaching: CommandCenterDriverCard[];
    driverEnRoute: CommandCenterDriverCard[];
    newOrders: CommandCenterNewOrderCard[];
    attentionRequired: CommandCenterAttentionCard[];
  };
  map: {
    drivers: CommandCenterMapDriver[];
    customers: CommandCenterMapCustomer[];
  };
  orderStatusBreakdown: Array<{ status: string; count: number; pct: number }>;
  prepTime: {
    averageMinutes: number | null;
    targetMinutes: number;
    percentileBetterThan: number | null;
  };
  topProducts: CommandCenterTopProduct[];
  financial: {
    currency: string;
    grossSalesMonth: number;
    platformCommissionMonth: number;
    netRevenueMonth: number;
    mmdImpactRevenue: number;
    newClientsMonth: number;
    loyalClientsPct: number | null;
    repeatOrdersPct: number | null;
    monthGrowthPct: number | null;
  };
};

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

async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("SESSION_EXPIRED");
  return token;
}

async function fetchRestaurantApi<T>(path: string): Promise<T> {
  const token = await getAuthToken();
  const base = String(API_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(out?.error ?? `HTTP_${res.status}`);
  }
  return out?.data as T;
}

export function fetchRestaurantCommandCenter() {
  return fetchRestaurantApi<RestaurantCommandCenterData>("/api/restaurant/command-center");
}

export function fetchRestaurantAiGrowth() {
  return fetchRestaurantApi<RestaurantAiGrowthData>("/api/restaurant/ai-growth");
}
