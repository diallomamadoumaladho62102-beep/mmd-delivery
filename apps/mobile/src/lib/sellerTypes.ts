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
  logo_url?: string | null;
  cover_image_url?: string | null;
  document_urls?: unknown;
  review_notes: string | null;
  stripe_account_id?: string | null;
  stripe_onboarding_status?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_onboarded_at?: string | null;
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
  stock_qty?: number | null;
  options_json?: unknown;
  variants_json?: unknown;
  promo_price_cents?: number | null;
  created_at: string;
  updated_at: string;
};

export type SellerOrderRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  payment_status?: string | null;
  currency: string;
  total_cents: number;
  country_code: string | null;
  region_code: string | null;
  notes: string | null;
  refund_status?: string | null;
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

export function sellerStatusLabel(
  status: SellerStatus | string,
  t: (key: string, defaultValue?: string) => string,
): string {
  switch (status) {
    case "approved":
      return t("seller.dashboard.status.approved", "Approved");
    case "rejected":
      return t("seller.dashboard.status.rejected", "Rejected");
    case "suspended":
      return t("seller.dashboard.status.suspended", "Suspended");
    default:
      return t("seller.dashboard.status.pending", "Pending review");
  }
}

/** `price_cents` is USD cents; for GNF/XOF it stores whole francs (no ÷100). */
export function formatMoney(cents: number, currency = "USD"): string {
  const code = String(currency ?? "USD").trim().toUpperCase() || "USD";
  const raw = Number(cents) || 0;
  if (code === "GNF" || code === "XOF") {
    const whole = Math.round(raw);
    return `${whole.toLocaleString("fr-FR")} ${code}`;
  }
  return `${(raw / 100).toFixed(2)} ${code}`;
}
