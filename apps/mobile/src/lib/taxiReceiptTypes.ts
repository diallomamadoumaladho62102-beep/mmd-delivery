/** Mobile-facing taxi receipt shape — mirrors GET /api/taxi/rides/:id/receipt */
export type TaxiReceipt = {
  company: {
    legal_name: string;
    brand: string;
    support_email: string;
    support_phone: string | null;
    support_url: string;
  };
  invoice: {
    invoice_number: string;
    ride_number: string;
    ride_id: string;
    issued_at: string;
    status: string;
    payment_status: string;
    refund_status: string | null;
    qr_url: string;
    currency: string;
  };
  trip: {
    pickup_address: string;
    dropoff_address: string;
    pickup_at: string | null;
    dropoff_at: string | null;
    distance_miles: number | null;
    duration_minutes: number | null;
    wait_fee_minutes: number | null;
    vehicle_category: string | null;
    map_static_url: string | null;
    stops: Array<{ label: string; address: string; stop_order: number }>;
  };
  driver: {
    name: string | null;
    photo_url: string | null;
    vehicle_label: string | null;
    plate: string | null;
    rating: number | null;
  } | null;
  fare_lines: Array<{
    key: string;
    label_key: string;
    amount_cents: number;
    kind: "charge" | "discount" | "info";
  }>;
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    discounts_cents: number;
    tip_cents: number;
    wait_fee_cents: number;
    total_paid_cents: number;
  };
  payment: {
    method: string;
    funding: string | null;
    brand: string | null;
    last4: string | null;
    payment_intent_id: string | null;
    status: string;
  };
  financial_timeline: Array<{
    id: string;
    kind: string;
    status: string;
    amount_cents: number;
    currency: string;
    direction: string;
    title_fallback: string;
    title_key: string;
    occurred_at: string;
    subtitle?: string | null;
  }>;
  actions: {
    can_tip: boolean;
    can_rate: boolean;
    can_rebook: boolean;
    can_report: boolean;
  };
};
