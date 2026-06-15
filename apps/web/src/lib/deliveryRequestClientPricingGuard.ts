export const FORBIDDEN_CLIENT_DELIVERY_PRICING_FIELDS = [
  "subtotal",
  "tax",
  "total",
  "grand_total",
  "currency",
  "delivery_fee",
  "delivery_fee_est",
  "total_cents",
  "distance_miles",
  "eta_minutes",
  "service_fee",
  "commission",
  "platform_amount",
  "payment_status",
] as const;

export function assertNoClientDeliveryPricingFields(body: Record<string, unknown>) {
  for (const key of FORBIDDEN_CLIENT_DELIVERY_PRICING_FIELDS) {
    if (body[key] !== undefined && body[key] !== null) {
      throw new Error(`Client-provided pricing field rejected: ${key}`);
    }
  }
}
