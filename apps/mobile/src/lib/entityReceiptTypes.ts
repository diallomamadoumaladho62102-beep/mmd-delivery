/** Shared food / package receipt shape — mirrors GET receipt APIs */
export type EntityReceipt = {
  company: {
    legal_name: string;
    brand: string;
    support_email: string;
    support_phone: string | null;
    support_url: string;
  };
  invoice: {
    invoice_number: string;
    entity_number: string;
    entity_id: string;
    issued_at: string;
    status: string;
    payment_status: string;
    refund_status: string | null;
    qr_url: string;
    currency: string;
  };
  delivery: {
    pickup_address: string;
    dropoff_address: string;
    pickup_at: string | null;
    dropoff_at: string | null;
    distance_miles: number | null;
    duration_minutes: number | null;
    eta_minutes: number | null;
    map_static_url: string | null;
  };
  merchant: {
    kind: "restaurant" | "package" | string;
    name: string;
    photo_url: string | null;
  } | null;
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
    service_fee_cents: number;
    delivery_fee_cents: number;
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

export type FoodOrderReceipt = EntityReceipt;
export type DeliveryRequestReceipt = EntityReceipt;
