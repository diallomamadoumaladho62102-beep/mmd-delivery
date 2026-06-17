export type SellerStatus = "pending" | "approved" | "rejected" | "suspended";

export type SellerRow = {
  id: string;
  user_id: string;
  business_name: string;
  country_code: string;
  city: string;
  address: string;
  phone: string;
  region_code: string | null;
  mmd_zone_id: string | null;
  status: SellerStatus;
  is_accepting_orders: boolean;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SellerProductRow = {
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

export type SellerOrderRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  currency: string;
  total_cents: number;
  country_code: string | null;
  region_code: string | null;
  notes: string | null;
  delivery_status_shadow?: string | null;
  delivery_quote_shadow?: {
    customer_delivery_total_cents?: number;
    estimated_distance_miles?: number;
    estimated_minutes?: number;
  } | null;
  estimated_distance_miles?: number | null;
  estimated_minutes?: number | null;
  driver_earning_shadow_cents?: number | null;
  dispatch_shadow?: {
    dispatch_readiness?: string | null;
    message?: string | null;
  } | null;
  created_at: string;
};

export function sellerStatusLabel(status: SellerStatus | string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "suspended":
      return "Suspended";
    default:
      return "Pending review";
  }
}

export function formatMoney(cents: number, currency = "USD"): string {
  const amount = (Number(cents) || 0) / 100;
  return `${amount.toFixed(2)} ${currency}`;
}
